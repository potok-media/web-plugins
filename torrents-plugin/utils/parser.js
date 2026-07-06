export class TorrentParser {
  // extractSeasonEpisode pulls season + episode from ONE name segment. Order is the whole trick:
  //   1) EPISODE ranges/markers are consumed FIRST, so a range like "1-8" / "01-11 из 11" is never misread
  //      as a season (the old greedy `(\d)-(\d)` = season-episode rule caused "Сезон:4 / Серии:1-8" → S1).
  //   2) SEASON markers in precedence order: digit-BEFORE «сезон» → digit-AFTER (Сезон: N / season N) →
  //      ТВ-N → S01 → NxM. Digit-before wins so "2 сезон 5 серия" → S2 (not S5 from the trailing episode).
  // Cyrillic-safe: JS `\b` is ASCII-only and never matches before Cyrillic, so Cyrillic markers use a manual
  // boundary `(?:^|[^a-zа-яё0-9])`. Separator-flexible ("Сезон: 4", "ТВ-2", "5 сезон"). Season is never ≤ 0.
  static extractSeasonEpisode(title) {
    const s = (title || "").replace(/_/g, " ");
    let episode;

    // --- episodes first (so a range never leaks into the season) ---
    const em = s.match(/сери[ияйю]\s*[:.№]?\s*(\d{1,3})\s*[-–]\s*\d{1,3}/i)              // Серии: 1-8
      || s.match(/\[\s*(\d{1,3})\s*[-–]\s*\d{1,3}\s*(?:из|of)\b/i)                        // [01-11 из 11]
      || s.match(/(?:^|[^a-zа-яё0-9])(?:ep|episode|эпизод)\s*[:.№]?\s*(\d{1,3})/i)         // Ep 3 / эпизод 5
      || s.match(/(\d{1,3})\s*(?:из|of)\s*\d{1,3}/i)                                       // 11 из 11
      || s.match(/(\d{1,3})\s*сери[ияйю]/i);                                              // 5 серия
    if (em) episode = parseInt(em[1], 10);

    // --- seasons, precedence: digit-before → digit-after → ТВ-N → S01 → NxM. Group 2 (when present) is the
    //     RANGE END, so multi-season packs ("S01-05", "1-4 сезон") expand to a full seasons[] array. ---
    let season, seasonEnd, m;
    if ((m = s.match(/(\d{1,2})\s*(?:[-–]\s*(\d{1,2})\s*)?сезон/i))) { season = +m[1]; seasonEnd = m[2] ? +m[2] : undefined; } // 5 сезон / 1-4 сезон
    else if ((m = s.match(/(?:сезон|season)\s*[:.№]?\s*(\d{1,2})/i))) { season = +m[1]; }                                     // Сезон: 4 / season 5
    else if ((m = s.match(/(?:^|[^a-zа-яё0-9])(?:тв|tv)[\s._-]*(\d{1,2})/i))) { season = +m[1]; }                              // ТВ-2 / TV 2
    else if ((m = s.match(/(?:^|[^a-zа-яё0-9])s(\d{1,2})(?:\s*[-–]\s*s?(\d{1,2}))?/i))) { season = +m[1]; seasonEnd = m[2] ? +m[2] : undefined; } // S01 / S01-05
    else if ((m = s.match(/(\d{1,2})x\d{1,3}/i))) { season = +m[1]; }                                                          // 05x01 → season 5

    if (episode === undefined) { const xm = s.match(/\d{1,2}x(\d{1,3})/i); if (xm) episode = parseInt(xm[1], 10); }
    if (season !== undefined && season <= 0) { season = undefined; seasonEnd = undefined; } // seasons are never 0 or negative

    // Expand a valid range into the full array; single season → [N]; nothing → undefined.
    let seasons;
    if (season !== undefined) {
      if (seasonEnd !== undefined && seasonEnd > season && seasonEnd - season <= 20) {
        seasons = [];
        for (let i = season; i <= seasonEnd; i++) seasons.push(i);
      } else {
        seasons = [season];
      }
    }
    return { season, seasons, episode };
  }

  // extractQualityTags pulls the cheap, deterministic bits (resolution / codec / year) so the sources list
  // keeps its quality tags + quality filter with NO LLM. Audio/dubbing-studio extraction is intentionally
  // absent — that's open-ended semantics regex can't do reliably (the one thing the dropped AI path was for).
  static extractQualityTags(title) {
    const s = title || "";
    let resolution, codec, year;

    if (/\b2160p\b|\b4k\b|\buhd\b/i.test(s)) resolution = "2160p";
    else if (/\b1080p\b|\bfull\s?hd\b|\bfhd\b/i.test(s)) resolution = "1080p";
    else if (/\b720p\b/i.test(s)) resolution = "720p";
    else if (/\b480p\b/i.test(s)) resolution = "480p";

    if (/\bx265\b/i.test(s)) codec = "x265";
    else if (/\b(?:hevc|h\.?\s?265)\b/i.test(s)) codec = "hevc";
    else if (/\bx264\b/i.test(s)) codec = "x264";
    else if (/\b(?:avc|h\.?\s?264)\b/i.test(s)) codec = "h264";
    else if (/\bav1\b/i.test(s)) codec = "av1";

    const ym = s.match(/\b(?:19|20)\d{2}\b/); // first year wins (== "earliest" for a 2019-2026 range)
    if (ym) year = parseInt(ym[0], 10);

    return { resolution, codec, year };
  }

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
      seasons: undefined,
      isSerial
    };

    const cleanPath = path.replace(/_/g, " ");
    const parts = cleanPath.split("/");
    const fileName = parts[parts.length - 1] || "";
    const folderName = parts.length > 1 ? parts[parts.length - 2] : "";

    // 1. Parse the filename (season + episode). `seasons` carries the full array for multi-season packs.
    const fromName = TorrentParser.extractSeasonEpisode(fileName);
    info.season = fromName.season;
    info.seasons = fromName.seasons;
    info.episode = fromName.episode;

    // 2. Fall back to the folder name for a still-missing season (e.g. "Season 2/01.mkv").
    if (folderName && info.season === undefined) {
      const fromFolder = TorrentParser.extractSeasonEpisode(folderName);
      if (fromFolder.season !== undefined) { info.season = fromFolder.season; info.seasons = fromFolder.seasons; }
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
      info.seasons = undefined;
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

  // The player is "dumb" — it plays whatever URL/streamType we hand it. These build the READY TorrentGo
  // HLS/subtitle URLs so the player never has to reverse-engineer them from a stream ref.
  static buildHlsUrl(baseUrl, hash, index) {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    return `${cleanBase}/api/torrents/${hash.toLowerCase()}/files/${index}/hls/master.m3u8`;
  }

  // Base subtitle endpoint (canonical /api path). The player appends `?format=<fmt>&start=<bucket>` per
  // window itself (windowed streaming), so we return only the base path here.
  static buildSubtitleBaseUrl(baseUrl, hash, index, relIndex) {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    return `${cleanBase}/api/torrents/${hash.toLowerCase()}/files/${index}/subtitles/${relIndex}`;
  }

  // Base thumbnail endpoint. The player fills `?time=<sec>` (rounded) per scrub position.
  static buildThumbnailBaseUrl(baseUrl, hash, index) {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    return `${cleanBase}/api/torrents/${hash.toLowerCase()}/files/${index}/thumbnail`;
  }
}
