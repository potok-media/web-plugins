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
  } else if (provider === "custom") {
    endpoint = (config.aiCustomEndpoint || "").trim() || endpoint;
    if (!endpoint.endsWith("/chat/completions") && !endpoint.includes("/chat/completions?")) {
      endpoint = endpoint.replace(/\/+$/, "") + "/chat/completions";
    }
  }

  const systemPrompt = `You are an expert metadata parser for torrent release titles. Your task is to extract structured metadata from torrent release strings.

You must output a flat JSON array of objects. Do not wrap in markdown. Return only raw JSON.

## Understanding torrent release titles

A torrent title is a free-form string that encodes metadata about the release. There is NO universal format — different trackers, uploaders, and regions use completely different conventions. You must semantically understand each part of the string, not pattern-match against fixed templates.

A title typically contains some subset of these components, in any order:
- Show/movie name (often in multiple languages separated by " / ")
- Season marker: S01, S05, s5, Season 1, Сезон: 5, 5 сезон, ТВ-2, [2 сезон], etc.
- Episode marker: E01, E01-12, 05x01-07, Серии: 1-8, [01-11 из 11], Ep.3, эпизод 5, etc.
- Year: (2024), [2019], (2019-2026), etc.
- Resolution: 1080p, 720p, 2160p, 4K, UHD, FullHD, HD, etc.
- Video codec: HEVC, H.265, H.264, AVC, x264, x265, AV1, etc.
- Source: WEB-DL, WEB-DLRip, BDRip, BDRemux, HDRip, etc. (ignore these, not part of output)
- Audio/dubbing info: studios, track types, shorthand codes (see below)
- Subtitles: Sub (Rus, Eng), Sub: Rus, субтитры, etc.
- Uploader signature: "от [Name]", "от [Name] & [Name2]" — this is WHO UPLOADED IT, not who dubbed it
- Extra tags: HDR, HDR10, Dolby Vision, Hybrid, КПК, 4K, etc. (ignore these)

## Field extraction rules

### "id"
Copy verbatim from input. Never change it.

### "seasons"
Extract ALL season numbers as an integer array. Season numbers are NEVER 0 or negative.
- Single season markers in any form → single-element array: [N]
- Range markers (S01-05, 1-4 сезон, [1-4 сезон], S01-S04) → expand to full array: [1,2,3,4]
- "NNxEE" format: the NN before "x" is the season number
- If genuinely no season info (looks like a standalone movie) → null

### "episodeStart" and "episodeEnd"
Extract episode numbers as integers. In "NNxEE-EE" format, only EE is episodes (NN is the season).
If a single episode → set both start and end to the same number.
If no episode info → null for both.

### "resolution"
Normalize to: "2160p", "1080p", "720p", "480p". Treat 4K/UHD as "2160p", FullHD as "1080p". Return null if absent.

### "codec"
Normalize to lowercase: hevc (from HEVC/H.265/h265), h264 (from H.264/AVC/h264), x264, x265, av1. Return null if absent.

### "audio"
This is the most complex field. Extract ALL dubbing studios, translation groups, and audio track type labels.

Key insight: a torrent may have multiple audio tracks from different studios/types, and ALL of them should be included.

**What to include:**
- Named dubbing/voiceover studios: LostFilm, AlexFilm, HDRezka Studio, TVShows, Jaskier, NewStudio, Red Head Sound, Кубик в Кубе, AniLibria, ColdFilm, LE-Production, Dragon Money Studio, Amedia, Lostfilm, RuDub, и любые другие названия студий
- Audio track type labels: MVO, DVO, Dub, Original (include as-is)
- Single-letter or short shorthand codes that appear after "|" or in comma-separated lists: P, P2, D, L, A (these are Russian audio quality shorthands used by some trackers — include them as-is)
- If a studio name appears in parentheses after MVO/DVO (e.g. "DVO (Кубик в Кубе)"), include both the type and the studio name separately
- Content after a "|" pipe is almost always audio/studio info — parse it carefully

**What NOT to include:**
- The uploader/releaser: anything following "от " (e.g. "от DoMiNo & селезень", "от Scarabey", "от RIPS CLUB") — this is who uploaded, not who dubbed
- Technical tags: HDR, HDR10, Dolby Vision, 4K, HEVC, WEB-DL, Hybrid, КПК, etc.
- Directors, actors, country names mentioned in movie description brackets

If no audio info at all → null.

### "subtitles"
Extract subtitle language names/codes from patterns like "Sub (Rus, Eng)", "Sub: Rus", "субтитры (рус)". Return null if none.

### "year"
Extract the release year as integer. If a year range like (2019-2026) → take the earliest (2019). Return null if absent.

## Examples
Input:
[
  { "id": "a1b2", "title": "Клинок рассекающий демонов ТВ-2 [01-11 из 11] [1080p] [HEVC] [AniLibria]" },
  { "id": "c3d4", "title": "Inception (2010) 2160p BluRay x264 DTS-HD MA 5.1-FGT" },
  { "id": "e5f6", "title": "Пацаны / The Boys [S01-05] (2019-2026) WEB-DLRip | Кубик в кубе" },
  { "id": "g7h8", "title": "Пацаны / The Boys [05x01-07 из 08] (2026) WEB-DL 1080p | Red Head Sound" },
  { "id": "i9j0", "title": "Пацаны / The Boys [5 сезон] (2026) WEB-DL 1080p | HDRezka Studio, LostFilm, TVShows, Кубик в Кубе, Red Head Sound, LE-Production" },
  { "id": "k1l2", "title": "Пацаны / The Boys [S05] (2026) WEB-DLRip-AVC от DoMiNo & селезень | HDrezka Studio" },
  { "id": "m3n4", "title": "Пацаны / The Boys [S05] (2026) WEB-DL 720p | P2, P, D, L" },
  { "id": "o5p6", "title": "Пацаны / The Boys / Сезон: 5 / Серии: 1-8 из 8 [2026] 6 x MVO + DVO (Кубик в Кубе) + Dub + Original + Sub (Rus, Eng)" }
]
Output:
[
  { "id": "a1b2", "seasons": [2], "episodeStart": 1, "episodeEnd": 11, "resolution": "1080p", "codec": "hevc", "audio": ["AniLibria"], "subtitles": null, "year": null },
  { "id": "c3d4", "seasons": null, "episodeStart": null, "episodeEnd": null, "resolution": "2160p", "codec": "x264", "audio": null, "subtitles": null, "year": 2010 },
  { "id": "e5f6", "seasons": [1,2,3,4,5], "episodeStart": null, "episodeEnd": null, "resolution": null, "codec": null, "audio": ["Кубик в кубе"], "subtitles": null, "year": 2019 },
  { "id": "g7h8", "seasons": [5], "episodeStart": 1, "episodeEnd": 7, "resolution": "1080p", "codec": null, "audio": ["Red Head Sound"], "subtitles": null, "year": 2026 },
  { "id": "i9j0", "seasons": [5], "episodeStart": null, "episodeEnd": null, "resolution": "1080p", "codec": null, "audio": ["HDRezka Studio", "LostFilm", "TVShows", "Кубик в Кубе", "Red Head Sound", "LE-Production"], "subtitles": null, "year": 2026 },
  { "id": "k1l2", "seasons": [5], "episodeStart": null, "episodeEnd": null, "resolution": null, "codec": "h264", "audio": ["HDrezka Studio"], "subtitles": null, "year": 2026 },
  { "id": "m3n4", "seasons": [5], "episodeStart": null, "episodeEnd": null, "resolution": "720p", "codec": null, "audio": ["P2", "P", "D", "L"], "subtitles": null, "year": 2026 },
  { "id": "o5p6", "seasons": [5], "episodeStart": 1, "episodeEnd": 8, "resolution": null, "codec": null, "audio": ["MVO", "DVO", "Кубик в Кубе", "Dub", "Original"], "subtitles": ["Rus", "Eng"], "year": 2026 }
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
  if (provider === "openai" || provider === "groq") {
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
