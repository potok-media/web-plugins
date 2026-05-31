const cloudEntryRe = /\{([^}]+)\}([^;,\\[\\{]+)/gi;

/**
 * Determines if the audio/voice track is in Russian.
 * @param {string} voiceName - The translator/voicing label
 * @returns {boolean}
 */
export function isRussian(voiceName) {
  const l = voiceName.toLowerCase();
  return l.includes("усск") || l.includes("rus") || l.includes("дубл") || l.includes("voiced");
}

/**
 * Normalizes dynamic balancer resolution codes to standard formats.
 * @param {string} q - Raw quality code
 * @returns {string}
 */
export function normalizeQuality(q) {
  switch (q.toUpperCase()) {
    case "4K": case "2160": return "2160p";
    case "FHD": case "1440": return "1440p";
    case "HD": case "1080": return "1080p";
    case "720": return "720p";
    case "SD": case "480": return "480p";
    case "360": return "360p";
    case "АВТО": case "AUTO": return "auto";
  }
  return q.toLowerCase();
}

/**
 * Extracts the first numeric value from a string.
 * @param {string} str
 * @returns {number}
 */
export function extractNum(str) {
  if (!str) return 1;
  const m = String(str).match(/([0-9]+)/);
  return m ? parseInt(m[1], 10) : 1;
}

/**
 * Extracts a balanced bracket enclosed string from text.
 * @param {string} text - The input text
 * @param {string} [startChar] - Defaults to "["
 * @param {string} [endChar] - Defaults to "]"
 * @returns {string|null}
 */
export function extractBalancedBracket(text, startChar = "[", endChar = "]") {
  const startIndex = text.indexOf(startChar);
  if (startIndex === -1) return null;
  let balance = 0;
  let result = "";
  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
    if (char === startChar) balance++;
    else if (char === endChar) balance--;
    result += char;
    if (balance === 0) break;
  }
  return result;
}

/**
 * Sorts voice/audio labels to prioritize Russian translations.
 * @param {string[]} voices
 * @returns {string[]}
 */
export function sortVoices(voices) {
  return [...voices].sort((a, b) => {
    const aRu = isRussian(a);
    const bRu = isRussian(b);
    if (aRu && !bRu) return -1;
    if (!aRu && bRu) return 1;
    return a.localeCompare(b);
  });
}

/**
 * Parses a standard PlayerJS playlist format: "[1080p]{Dubbing}https://...;{Line}https://...;,[720p]..."
 * @param {string} raw - Raw playlist text
 * @returns {Record<string, Array<{quality: string, url: string}>>|null}
 */
export function parsePlayerJSFile(raw) {
  if (!raw) return null;
  
  const trimmed = raw.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("//")) {
    return {
      "default": [{ quality: "1080p", url: trimmed }]
    };
  }
  
  const voiceStreams = {};
  const segments = raw.split(/,(?=\[)/); 
  
  for (const segment of segments) {
    const qualMatch = segment.match(/^\[([^\]]+)\]/);
    if (!qualMatch) continue;
    
    const quality = qualMatch[1];
    const dataPart = segment.substring(qualMatch[0].length);
    
    let entryMatch;
    cloudEntryRe.lastIndex = 0;
    
    while ((entryMatch = cloudEntryRe.exec(dataPart)) !== null) {
      const voice = entryMatch[1].trim();
      const url = entryMatch[2].trim().replace(/[;,]$/, "");
      
      if (!voiceStreams[voice]) {
        voiceStreams[voice] = [];
      }
      voiceStreams[voice].push({ quality, url });
    }
  }
  return voiceStreams;
}
