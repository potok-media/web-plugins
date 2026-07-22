export class TorrentParser {
  // extractSeasonEpisode pulls season + episode from ONE name segment. Order is the whole trick:
  //   1) EPISODE ranges/markers are consumed FIRST, so a range like "1-8" / "01-11 из 11" is never misread
  //      as a season (the old greedy `(\d)-(\d)` = season-episode rule caused "Сезон:4 / Серии:1-8" → S1).
  //   2) SEASON markers in precedence order: digit-BEFORE «сезон» → digit-AFTER (Сезон: N / season N) →
  //      ТВ-N → S01 → NxM. Digit-before wins so "2 сезон 5 серия" → S2 (not S5 from the trailing episode).
  // Cyrillic-safe: JS `\b` is ASCII-only and never matches before Cyrillic, so Cyrillic markers use a manual
  // boundary `(?:^|[^a-zа-яё0-9])`. Separator-flexible ("Сезон: 4", "ТВ-2", "5 сезон"). Season is never ≤ 0.
  static extractSeasonEpisode(title) {
    // Strip resolution tokens FIRST. «1920x1080» / «1280x720» would otherwise be read by the NxM heuristics
    // below as season 20 + episode 108 (etc.), collapsing every same-resolution file onto one episode. We do
    // NOT cap the NxM number range low — a season can hold ~100 episodes — so resolutions are removed by their
    // 3-4-digit dimensions instead: real anime NxM markers («05x01») are 1-2 digits per side and survive.
    const s = (title || "")
      .replace(/_/g, " ")
      .replace(/\b\d{3,4}\s*[x×]\s*\d{3,4}\b/gi, " ")   // 1920x1080 / 1280×720 → gone
      .replace(/\b(?:2160|1080|720|576|480)[pi]\b/gi, " "); // 1080p / 720i → gone
    let episode, kind, ovaNumber;

    // --- episodes first (so a range never leaks into the season) ---
    const em = s.match(/сери[ияйю]\s*[:.№]?\s*(\d{1,3})\s*[-–]\s*\d{1,3}/i)              // Серии: 1-8
      || s.match(/\[\s*(\d{1,3})\s*[-–]\s*\d{1,3}\s*(?:из|of)\b/i)                        // [01-11 из 11]
      || s.match(/(?:^|[^a-zа-яё0-9])(?:ep|episode|эпизод)\s*[:.№]?\s*(\d{1,3})/i)         // Ep 3 / эпизод 5
      || s.match(/(\d{1,3})\s*(?:из|of)\s*\d{1,3}/i)                                       // 11 из 11
      || s.match(/(\d{1,3})\s*сери[ияйю]/i)                                               // 5 серия
      || s.match(/(?:^|[^a-zа-яё0-9])s\d{1,2}[\s._-]*e(\d{1,3})/i)                         // S04E01 / S04.E01 → episode 1
      || s.match(/[\s._]-\s*(\d{1,3})(?:v\d+)?(?=[\s._([]|$)/i);                           // «Name - 01» / «Name - 01v2 (» (fansub style)
    if (em) episode = parseInt(em[1], 10);

    // --- specials → season 0. Creditless OP/ED (NCOP/NCED/NCBD), SP/Special(s), OVA/OAD/ONA, RU «спэшл /
    //     спецвыпуск», bonus/extra. Detected BEFORE seasons so their «wo! 3» / «3 Bonus Stage» is never read
    //     as a TV season. These carry no TMDB season, so we map them to season 0 (the specials bucket). ---
    const isSpecial =
      /(?:^|[^a-zа-яё0-9])(?:nc(?:op|ed|bd)|ova|oad|ona|specials?|sp\s*\d|спэшл|спешл|спецвыпуск|бонус)(?![a-zа-яё])/i.test(s)
      // Fractional episode «… - 24.5 …» = a recap/special that sits between numbered episodes. Anchored to the
      // «- N.M» slot so it never fires on audio-channel notation (5.1 / 7.1) elsewhere in the name.
      || /[\s._]-\s*\d{1,3}\.\d+(?=[\s._([]|$)/.test(s);
    // --- kind: OVA/special vs Movie vs TV. Anime specials come as ОВА-3 / OVA-3 / [OVA] / [2025, OVA,…],
    //     mixed across languages in one title. Cyrillic «ова» + Latin «ova» (NOT «она»/«ona» — «она» is a
    //     common RU word); optional trailing number = the OVA index. The leading boundary skips surnames
    //     («Иванова»), the lookahead skips «ovation». OVA is NOT a TV season → handled as a special below. ---
    const ovaM = s.match(/(?:^|[^a-zа-яё0-9])(?:ова|ova)(?:[\s._:()-]*(\d{1,2}))?(?![a-zа-яё])/i);
    if (ovaM) {
      kind = "ova";
      if (ovaM[1]) ovaNumber = parseInt(ovaM[1], 10);
    } else if (/(?:^|[^a-zа-яё0-9])(?:фильм|movie|gekijou?ban?|劇場)/i.test(s)) {
      kind = "movie";
    } else if (/\[\s*(?:tv|тв)\s*\]/i.test(s) || /(?:^|[^a-zа-яё0-9])(?:тв|tv)[\s._-]*\d{1,2}/i.test(s)) {
      kind = "tv";
    }

    // --- seasons (TV only), precedence: digit-before → digit-after → ТВ-N → S01 → NxM, then a conservative
    //     «!»-anchored bare-number fallback («…wo! 3» / «…мир! 3» → S3). Group 2 is the RANGE END, so packs
    //     ("S01-05", "1-4 сезон") expand to a full seasons[] array. ---
    let season, seasonEnd, m;
    // STRONG explicit markers («N сезон» / «Сезон: N» / «Nrd Season») win even on a special-tagged title — a
    // pack «1 сезон … + спэшл» is season 1, NOT a special-0. Skipped only for OVA/movie (a real OVA is not a
    // TV season). Non-OVA specials (NCED/спэшл) run these so their explicit season, if any, survives.
    if (kind !== "ova" && kind !== "movie") {
      if ((m = s.match(/(\d{1,2})\s*(?:[-–]\s*(\d{1,2})\s*)?сезон/i))) { season = +m[1]; seasonEnd = m[2] ? +m[2] : undefined; } // 5 сезон / 1-4 сезон
      else if ((m = s.match(/(?:сезон|season)\s*[:.№]?\s*(\d{1,2})/i))) { season = +m[1]; }                                     // Сезон: 4 / season 5
      else if ((m = s.match(/(\d{1,2})(?:st|nd|rd|th)\s+season/i))) { season = +m[1]; }                                          // «2nd Season» / «3rd Season» (AniLibria)
    }
    // WEAKER markers (ТВ-N / S01 / NxM / «!»-anchored bare number): ambiguous on OVA/special titles where a bare
    // number is usually noise, so they stay skipped there. Only fill a season not already found above.
    if (kind !== "ova" && kind !== "movie" && !isSpecial && season === undefined) {
      if ((m = s.match(/(?:^|[^a-zа-яё0-9])(?:тв|tv)[\s._-]*(\d{1,2})/i))) { season = +m[1]; }                                    // ТВ-2 / TV 2
      else if ((m = s.match(/(?:^|[^a-zа-яё0-9])s(\d{1,2})(?:\s*[-–]\s*s?(\d{1,2}))?/i))) { season = +m[1]; seasonEnd = m[2] ? +m[2] : undefined; } // S01 / S01-05 (S01E05-safe: no trailing anchor)
      else if ((m = s.match(/(\d{1,2})x\d{1,3}/i))) { season = +m[1]; }                                                          // 05x01 → season 5
      else if ((m = s.match(/[!！]\s+(\d{1,2})(?=\s|:|$|\/|\[|,)/))) { season = +m[1]; }                                          // «…wo! 3» / «…мир! 3 [»
    }

    if (episode === undefined) { const xm = s.match(/(?:^|[^\d])\d{1,2}x(\d{1,3})/i); if (xm) episode = parseInt(xm[1], 10); }
    if (season !== undefined && season <= 0) { season = undefined; seasonEnd = undefined; } // seasons are never 0 or negative (0 is reserved for specials, set below)

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

    // Specials land in season 0 (the TMDB specials bucket) unless a real season was already found. Done AFTER
    // the «season <= 0» guard so this intentional 0 survives, and after expansion so it's a clean single season.
    if (isSpecial && season === undefined) { season = 0; seasons = [0]; kind = kind || "special"; }

    return { kind, season, seasons, episode, ovaNumber };
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

  // Pure name/folder parse (season + episode). Overrides are NO LONGER applied here — getEpisodes owns the
  // per-source-season remap using the SearchEngine seasonMap (see [[torrents-plugin]] index.js).
  static parseEpisode(
    path,
    mediaType,
    numberOfSeasons
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

    // 2b. Folder-signal specials: a file living under an NC / Specials / OVA / Extras / … folder is a special →
    // season 0. A whole-segment match (anchored) so the show's own folder («[Moozzi2] Tensei Shitara Slime …»)
    // never matches. Applied only when the file name itself didn't resolve a concrete positive season.
    if (info.season === undefined || info.season === 0) {
      const SPECIAL_FOLDER = /^\[?\(?(?:nc|ncop|nced|ncbd|op|ed|sp|specials?|extras?|bonus(?:es)?|ova|oad|ona|menus?|pv|cm|scans?)\)?\]?(?:[\s._-].*)?$/i;
      if (parts.slice(0, -1).some((seg) => SPECIAL_FOLDER.test(seg.trim()))) info.season = 0;
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
  static buildHlsUrl(baseUrl, hash, index, ext) {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    let url = `${cleanBase}/api/torrents/${hash.toLowerCase()}/files/${index}/hls/master.m3u8`;
    // External ("ext" release) sidecar tracks: dub audio files (?xa=) fold into the HLS master as extra
    // EXT-X-MEDIA audio renditions; external subtitle files (?xs=) are read by getPlaybackMetadata off the
    // same URL. Values are plain numeric torrent indices — no encoding needed, tiny, and they survive the
    // player's stream-URL round-trip (resume / autoplay) verbatim.
    const params = [];
    if (ext && ext.audio && ext.audio.length) params.push(`xa=${ext.audio.join(",")}`);
    if (ext && ext.subs && ext.subs.length) params.push(`xs=${ext.subs.join(",")}`);
    if (params.length) url += `?${params.join("&")}`;
    return url;
  }

  // External subtitle FILE endpoint (a separate file in the torrent, "ext" releases): serves the whole file as
  // VTT/ASS. Distinct from buildSubtitleBaseUrl (which extracts an embedded track from the video container).
  static buildExternalSubtitleUrl(baseUrl, hash, fileIndex) {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    return `${cleanBase}/api/torrents/${hash.toLowerCase()}/files/${fileIndex}/subtitle-file`;
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
