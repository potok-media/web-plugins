export class TorrentParser {
  static regexps = [
    { regex: /\bs(\d+)\.?ep?(\d+)\b/i, keys: ["season", "episode"] },
    { regex: /\b(\d{1,2})[x-](\d+)\b/i, keys: ["season", "episode"] },
    { regex: /\bs(\d{2})(\d{2,3})\b/i, keys: ["season", "episode"] },
    { regex: /season (\d+) episode (\d+)/i, keys: ["season", "episode"] },
    { regex: /сезон (\d+) серия (\d+)/i, keys: ["season", "episode"] },
    { regex: /(\d+)(?:st|nd|rd|th)?\s*season (\d+) episode/i, keys: ["season", "episode"] },
    { regex: /(\d+)\s*сезон (\d+) серия/i, keys: ["season", "episode"] },
    { regex: /episode (\d+)/i, keys: ["episode"] },
    { regex: /серия (\d+)/i, keys: ["episode"] },
    { regex: /(\d+) episode/i, keys: ["episode"] },
    { regex: /(\d+) серия/i, keys: ["episode"] },
    { regex: /season (\d+)/i, keys: ["season"] },
    { regex: /сезон (\d+)/i, keys: ["season"] },
    { regex: /(\d+)(?:st|nd|rd|th)?\s*season/i, keys: ["season"] },
    { regex: /(\d+)\s*сезон/i, keys: ["season"] },
    { regex: /\bs(\d+)\b/i, keys: ["season"] },
    { regex: /\bep?\.?(\d+)\b/i, keys: ["episode"] },
    { regex: /\b(\d{1,3}) of (\d+)\b/i, keys: ["episode"] },
    { regex: /\b(\d{1,3}) из (\d+)\b/i, keys: ["episode"] },
    { regex: / - (\d{1,3})\b/i, keys: ["episode"] },
    { regex: /\[(\d{1,3})\]/i, keys: ["episode"] },
    { regex: /(\d+)\s*сер/i, keys: ["episode"] }
  ];

  static folderRegexps = [
    { regex: /season (\d+)/i, key: "season" },
    { regex: /сезон (\d+)/i, key: "season" },
    { regex: /(\d+)(?:st|nd|rd|th)?\s*season/i, key: "season" },
    { regex: /(\d+)\s*сезон/i, key: "season" },
    { regex: /\bs(\d+)\b/i, key: "season" },
    { regex: /tv[ -]?(\d+)/i, key: "season" },
    { regex: /тв[ -]?(\d+)/i, key: "season" }
  ];

  static parseEpisode(
    path,
    mediaType,
    numberOfSeasons,
    overrideSeason,
    overrideEpisodeOffset,
    fileIndex
  ) {
    const isSerial = mediaType === "tv" || (numberOfSeasons ?? 0) > 0;
    const info = {
      episode: undefined,
      season: undefined,
      isSerial
    };

    const cleanPath = path.replace(/_/g, " ");
    const parts = cleanPath.split("/");
    const fileName = parts[parts.length - 1] || "";
    const folderName = parts.length > 1 ? parts[parts.length - 2] : "";

    // 1. Parse filename
    for (const { regex, keys } of this.regexps) {
      if (info.season !== undefined && info.episode !== undefined) { break; }
      const match = fileName.match(regex);
      if (match) {
        keys.forEach((key, index) => {
          const valStr = match[index + 1];
          if (valStr) {
            const value = parseInt(valStr, 10);
            if (!isNaN(value)) {
              if (key === "season" && info.season === undefined) {
                info.season = value;
              } else if (key === "episode" && info.episode === undefined) {
                info.episode = value;
              }
            }
          }
        });
      }
    }

    // 2. Parse folder name if season still missing
    if (folderName && info.season === undefined) {
      for (const { regex } of this.folderRegexps) {
        const match = folderName.match(regex);
        if (match && match[1]) {
          const value = parseInt(match[1], 10);
          if (!isNaN(value)) {
            info.season = value;
            break;
          }
        }
      }
    }

    // Default season for non-serials or if missing
    if (info.season === undefined) {
      info.season = isSerial ? undefined : 0;
    }

    // Special case: episode number at the very beginning of filename (e.g. "01.mkv")
    if (info.episode === undefined) {
      const startDigitsMatch = fileName.match(/^(\d{1,3})\b/);
      if (startDigitsMatch && startDigitsMatch[1]) {
        const value = parseInt(startDigitsMatch[1], 10);
        if (!isNaN(value)) {
          info.episode = value;
        }
      }
    }

    // 3. Validate parsed season against TMDB (before overrides!)
    if (numberOfSeasons && numberOfSeasons > 0 && info.season !== undefined && info.season > numberOfSeasons) {
      info.season = undefined; // Trigger manual fix / parsing failure
    }

    // 4. Apply Overrides (User overrides are the absolute source of truth!)
    if (overrideSeason !== undefined && overrideSeason !== null) {
      info.season = overrideSeason;
      
      // If we have an override, we map episodes sequentially based on the file index in the sorted list!
      if (fileIndex !== undefined) {
        const offset = overrideEpisodeOffset ?? 0;
        info.episode = offset + 1 + fileIndex;
      } else if (overrideEpisodeOffset !== undefined && overrideEpisodeOffset !== null && info.episode !== undefined) {
        info.episode = Math.max(1, info.episode + overrideEpisodeOffset);
      }
    } else {
      if (overrideEpisodeOffset !== undefined && overrideEpisodeOffset !== null && info.episode !== undefined) {
        info.episode = Math.max(1, info.episode + overrideEpisodeOffset);
      }
    }

    return info;
  }

  static cleanTitles(files) {
    if (files.length <= 1) return files;

    const titles = files.map((f) => (f.title || "").split(" "));
    const firstParts = titles[0];
    if (!firstParts) return files;

    let commonLength = 0;
    while (commonLength < firstParts.length) {
      const part = firstParts[commonLength];
      if (titles.every((t) => t.length > commonLength && t[commonLength] === part)) {
        commonLength++;
      } else {
        break;
      }
    }

    if (commonLength === 0 || commonLength >= firstParts.length) return files;

    return files.map((file, index) => {
      const parts = titles[index];
      if (!parts || parts.length <= commonLength) return file;
      const newTitle = parts.slice(commonLength).join(" ").trim();
      return {
        ...file,
        title: newTitle || file.title
      };
    });
  }

  static getFileExtension(path) {
    if (!path) return ".mkv";
    const match = path.match(/\.[a-zA-Z0-9]{2,5}$/);
    return match ? match[0] : ".mkv";
  }

  static generateStreamUrl(params) {
    const cleanBase = params.baseUrl.replace(/\/+$/, "");
    let filename = "";
    if (params.originalPath) {
      const parts = params.originalPath.split("/");
      filename = parts[parts.length - 1] || "";
    }
    if (!filename) {
      filename = "video.mkv";
    }
    const encodedFilename = encodeURIComponent(filename);
    return `${cleanBase}/api/torrents/${params.hash.toLowerCase()}/files/${params.index}/stream/${encodedFilename}`;
  }

  // The player is "dumb" — it plays whatever URL/streamType we hand it. These build the READY TorrentGo
  // HLS/subtitle URLs so the player never has to reverse-engineer them from a stream ref.
  static buildHlsUrl(baseUrl, hash, index) {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    return `${cleanBase}/api/torrents/${hash.toLowerCase()}/files/${index}/hls/master.m3u8`;
  }

  // Per-audio-track HLS URL. TorrentGo muxes ONE audio track per producer keyed by the absolute input
  // stream index (`-map 0:N`); switching audio = reloading with a different `?audio=N`. The default/first
  // audio uses the NO-param URL (backend `0:a:0?`) so it stays aligned with the keepalive `audio=""`.
  static buildAudioUrl(hlsUrl, absIndex) {
    return `${hlsUrl}${hlsUrl.includes("?") ? "&" : "?"}audio=${absIndex}`;
  }

  // Base subtitle endpoint. The player appends `?format=<fmt>&start=<bucket>` per 15s window itself
  // (windowed streaming), so we return only the base path here.
  static buildSubtitleBaseUrl(baseUrl, hash, index, relIndex) {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    return `${cleanBase}/stream/${hash.toLowerCase()}/${index}/subtitles/${relIndex}`;
  }
}
