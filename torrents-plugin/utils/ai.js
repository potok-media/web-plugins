import { PotokSDK } from 'potok-sdk';

/**
 * Batch parses torrent release metadata (seasons, episodes, resolutions, codecs, audio, subtitles, years)
 * from titles using the configured LLM provider.
 * 
 * @param {Array<{id: string, title: string}>} items 
 * @param {Object} config 
 * @returns {Promise<Array<Object>|null>}
 */
export async function batchParseMetadata(items, config) {
  if (!items || items.length === 0) return null;

  const apiKey = (config.aiApiKey || "").trim();
  const provider = config.aiProvider || "groq";
  const model = config.aiModelName || "llama-3.1-8b-instant";

  if (!apiKey) {
    console.warn("AI API Key is missing. Skipping AI parsing.");
    return null;
  }
  // Determine endpoint
  let endpoint = "https://api.groq.com/openai/v1/chat/completions";
  if (provider === "openai") {
    endpoint = "https://api.openai.com/v1/chat/completions";
  } else if (provider === "gemini") {
    endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  } else if (provider === "custom") {
    endpoint = (config.aiCustomEndpoint || "").trim() || endpoint;
    if (!endpoint.endsWith("/chat/completions") && !endpoint.includes("/chat/completions?")) {
      endpoint = endpoint.replace(/\/+$/, "") + "/chat/completions";
    }
  }

  const systemPrompt = `You are a dedicated media release metadata extractor. Your job is to parse media release titles and extract metadata parameters.
You must output a flat JSON array of objects. Do not wrap it in markdown code blocks like \`\`\`json. Return only raw JSON.

Input JSON format:
[
  { "id": "hash-identifier", "title": "Media Release Name string" }
]

Output JSON format:
[
  {
    "id": "hash-identifier",
    "seasons": [1], 
    "episodeStart": 1,
    "episodeEnd": 12,
    "resolution": "1080p",
    "codec": "h264",
    "audio": ["AniLibria"],
    "subtitles": ["rus"],
    "year": 2024
  }
]

Parsing Rules:
1. "id": Must match the input "id" field exactly.
2. "seasons": An array of season numbers (integers). Extract from patterns like "S01", "Season 1", "1 сезон", "ТВ-1" (translates to [1]), "ТВ-2" (translates to [2]). Return null if not a series or not found.
3. "episodeStart" / "episodeEnd": Episode range integers. If a single episode, e.g. "Ep 05", set both start and end to 5. If "01-12", set start to 1 and end to 12. Return null if not found.
4. "resolution": Standardized string like "1080p", "720p", "2160p", "480p", or null.
5. "codec": Lowcase codec name like "hevc", "h265", "h264", "av1", "x264", or null.
6. "audio": Array of strings representing voiceover groups, translation studios, or audio languages, e.g. ["AniLibria", "LostFilm", "Red Head Sound", "Dub", "Original"]. Extract from square brackets, parentheses, or trailing text. Return null if not found.
7. "subtitles": Array of strings representing subtitle languages (e.g. ["rus", "eng"]), or null.
8. "year": 4-digit release year integer, or null.

Few-shot examples:
Input:
[
  { "id": "a1b2", "title": "Клинок рассекающий демонов ТВ-2 [01-11 из 11] [1080p] [HEVC] [AniLibria]" },
  { "id": "c3d4", "title": "Inception (2010) 2160p BluRay x264 DTS-HD MA 5.1-FGT" }
]
Output:
[
  {
    "id": "a1b2",
    "seasons": [2],
    "episodeStart": 1,
    "episodeEnd": 11,
    "resolution": "1080p",
    "codec": "hevc",
    "audio": ["AniLibria"],
    "subtitles": null,
    "year": null
  },
  {
    "id": "c3d4",
    "seasons": null,
    "episodeStart": null,
    "episodeEnd": null,
    "resolution": "2160p",
    "codec": "x264",
    "audio": null,
    "subtitles": null,
    "year": 2010
  }
]`;

  const userPrompt = JSON.stringify(items.map(item => ({ id: item.id, title: item.title })));

  const requestBody = {
    model: model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.1
  };

  // Enable JSON Mode if possible
  if (provider === "openai" || provider === "groq" || provider === "gemini") {
    requestBody.response_format = { type: "json_object" };
  }

  try {
    const response = await PotokSDK.http.post(endpoint, requestBody, {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    });

    if (response.status !== 200) {
      throw new Error(`LLM provider returned status code ${response.status}`);
    }

    const resData = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
    let text = resData.choices?.[0]?.message?.content || "";
    text = text.trim();


    // Clean markdown blocks if LLM ignored instructions
    if (text.startsWith("```")) {
      text = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    // Parse extracted array
    let parsedArray = JSON.parse(text);
    if (parsedArray && typeof parsedArray === "object" && !Array.isArray(parsedArray)) {
      // In some cases JSON mode returns wrapper object like { "results": [...] } or similar
      const possibleKey = Object.keys(parsedArray).find(k => Array.isArray(parsedArray[k]));
      if (possibleKey) {
        parsedArray = parsedArray[possibleKey];
      }
    }

    if (Array.isArray(parsedArray)) {
      return parsedArray;
    }
    return null;
  } catch (err) {
    console.error("Failed to batch parse metadata with AI:", err);
    return null;
  }
}
