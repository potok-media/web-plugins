import { PotokSDK } from 'potok-sdk';
import { TorrentParser } from './utils/parser.js';
import { registerSidebarStatus } from './utils/status.js';
import { applyTMDBMetadata } from './utils/metadata.js';
import { resolveTorrUrl, resolveSearchEngineUrl } from './utils/config.js';

// Register full translations for torrents-plugin namespace
PotokSDK.i18n.registerTranslations({
  en: {
    "potok-torrents": {
      manifest: {
        name: "Torrent Search",
        watch: "Watch",
        statusTitle: "Torrents Status"
      },
      config: {
        torrentGoUrl: "TorrentGo Address",
        searchEngineUrl: "SearchEngine Address"
      },
      errors: {
        noSearchUrl: "SearchEngine address is not configured.",
        noTorrUrl: "TorrentGo address is not configured.",
        torrGoError: "TorrentGo error (status {{status}})",
        noMediaFiles: "No supported media files found in the torrent."
      },
      status: {
        mediaSearch: "Media Search",
        torrentPlayer: "Torrent Player",
        off: "off",
        offline: "offline"
      },
      ui: {
        seasonNotDetected: "Season not detected",
        correctSeason: "Correct season",
        subtitles: "Subtitles",
        file: "File",
        episode: "Episode",
        serial: "Series",
        video: "Video"
      }
    }
  },
  ru: {
    "potok-torrents": {
      manifest: {
        name: "Поиск торрентов",
        watch: "Смотреть",
        statusTitle: "Статус Торрентов"
      },
      config: {
        torrentGoUrl: "Адрес TorrentGo",
        searchEngineUrl: "Адрес SearchEngine"
      },
      errors: {
        noSearchUrl: "Адрес поисковика SearchEngine не настроен.",
        noTorrUrl: "Адрес торрент-плеера TorrentGo не настроен.",
        torrGoError: "Ошибка TorrentGo (статус {{status}})",
        noMediaFiles: "В раздаче не найдено поддерживаемых медиафайлов."
      },
      status: {
        mediaSearch: "Поиск медиа",
        torrentPlayer: "Торрент-плеер",
        off: "выкл",
        offline: "оффлайн"
      },
      ui: {
        seasonNotDetected: "Сезон не определен",
        correctSeason: "Исправить сезон",
        subtitles: "Субтитры",
        file: "Файл",
        episode: "Серия",
        serial: "Сериал",
        video: "Видео"
      }
    }
  }
});

// Clean hash matching SDK
function cleanHash(hash) {
  if (!hash) return "";
  return hash.replace(/^urn:btih:/i, "").split("&")[0].trim().toLowerCase();
}

// Recover the infohash from a TorrentGo URL (`.../api/torrents/{40-hex}/...`). getEpisodes bakes the
// authoritative hash into each episode URL, so getPlaybackInfo can recover it even if the host strips
// the custom `torrentHash` field off the episode object.
function parseHashFromUrl(url) {
  if (!url) return "";
  const m = String(url).match(/\/api\/torrents\/([0-9a-fA-F]{40})\b/);
  return m ? m[1].toLowerCase() : "";
}

// Best-effort human language name from an ISO code using Intl.DisplayNames dynamic locale
function langName(code) {
  if (!code) return "";
  const c = String(code).trim().toLowerCase();
  try {
    const locale = PotokSDK.i18n.locale || "en";
    const formatter = new Intl.DisplayNames([locale], { type: "language" });
    const name = formatter.of(c);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : c.toUpperCase();
  } catch (e) {
    return c.toUpperCase();
  }
}

// Display-ready subtitle label (plain string — the dumb player just renders it). Audio labels are NOT
// built here anymore: audio renditions live in the HLS master (EXT-X-MEDIA NAME/LANGUAGE from the
// backend) and hls.js exposes them natively.
function buildSubtitleLabel(t, i) {
  const lang = langName(t.language || t.languageCode);
  const codec = (t.codec || "").toUpperCase();
  const title = (t.title || t.name || t.label || "").trim();
  const generic = /^(subtitle|sub|субтитры|саб)\s*#?\d*$/i;
  const rel = (typeof t.relIndex === "number") ? t.relIndex : i;
  const subText = PotokSDK.i18n.t("potok-torrents:ui.subtitles");
  const primary = (title && !generic.test(title)) ? title : (lang || `${subText} #${rel}`);
  return codec ? `${primary} (${codec})` : primary;
}

// Frontend relevance filter. SearchEngine returns fuzzy matches — searching KonoSuba ("Да благословят боги
// сей расчудесный мир!") also yields "Да, я паук, и что?" / "Да, я Сакамото, и что?" (matched on the shared
// leading word). We know what was searched, so drop results that share ZERO significant title tokens with the
// query — a different show. Conservative: only kills clear mismatches, and does nothing when the query title
// is too short to discriminate safely. No AI, no tokens; runs BEFORE the AI batch so garbage costs nothing.
const RELEVANCE_STOPWORDS = new Set(["да", "и", "что", "я", "в", "на", "с", "the", "a", "of", "on", "this", "from", "от", "за", "по"]);
function relevanceTokens(s) {
  return (s || "").toLowerCase()
    .replace(/[!?.,:;/()\[\]{}|"“”«»_+\-]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !RELEVANCE_STOPWORDS.has(w) && !/^\d+$/.test(w));
}
function filterRelevantResults(results, queryTitle) {
  const expected = new Set(relevanceTokens(queryTitle));
  if (expected.size < 2) return results; // too short/ambiguous → don't risk false drops
  return results.filter(t => {
    const res = relevanceTokens(t.title);
    for (const w of res) if (expected.has(w)) return true; // ≥1 shared significant token → keep
    return false; // zero overlap → a different show
  });
}

// Resolve the SYNCHRONOUS half of a playback descriptor (no I/O): hash, fileIndex, HLS url, and the
// session/thumbnails endpoints — all derivable from the stream/episode alone. getPlaybackInfo returns this
// instantly so the player opens immediately with its waiting overlay; the slow /metadata probe is deferred.
async function resolvePlaybackBase(stream, episode) {
  const cleanTorrUrl = await resolveTorrUrl();
  const fileIndex = String(episode && episode.id != null ? episode.id : "");
  const hash = cleanHash(
    (episode && episode.torrentHash) ||
    parseHashFromUrl(episode && episode.url) ||
    stream.hash || stream.url || stream.magnet || ""
  );
  const hlsUrl = (cleanTorrUrl && fileIndex)
    ? TorrentParser.buildHlsUrl(cleanTorrUrl, hash, fileIndex)
    : ((episode && episode.url) || stream.url || stream.streamUrl || "");
  const hasBackend = !!(cleanTorrUrl && fileIndex && hash);
  const session = hasBackend
    ? {
        keepaliveUrl: `${cleanTorrUrl}/api/playback/keepalive`,
        stopUrl: `${cleanTorrUrl}/api/playback/stop`,
        // Generic status endpoint the dumb player polls for warm-up progress (backend peers/speed → generic).
        statusUrl: `${cleanTorrUrl}/api/torrents/${hash}`,
        statusIntervalSec: 2,
        intervalSec: 7,
        hash,
        file: fileIndex,
      }
    : undefined;
  // Generic scrub-preview template ({time} → rounded seconds). The player never learns it's a torrent.
  const thumbnails = hasBackend
    ? { urlTemplate: `${TorrentParser.buildThumbnailBaseUrl(cleanTorrUrl, hash, fileIndex)}?time={time}`, intervalSec: 5 }
    : undefined;
  return { cleanTorrUrl, fileIndex, hash, hlsUrl, hasBackend, session, thumbnails };
}

// The DEFERRED slow half: probe TorrentGo /metadata for subtitle tracks + duration (needs the container
// header resident, so cold-start slow). Returns {} on any failure (degraded: player keeps playing, no menus).
async function fetchPlaybackMetadata(cleanTorrUrl, hash, fileIndex) {
  if (!cleanTorrUrl || !fileIndex) return {};
  try {
    const metadataUrl = `${cleanTorrUrl}/api/torrents/${hash}/files/${fileIndex}/metadata`;
    const metadataResponse = await PotokSDK.http.get(metadataUrl);
    const metadata = (metadataResponse && metadataResponse.status === 200)
      ? (typeof metadataResponse.data === 'string' ? JSON.parse(metadataResponse.data) : metadataResponse.data)
      : null;
    if (!metadata) return {};

    const duration = (typeof metadata.duration === 'number') ? metadata.duration : undefined;
    let subtitles = undefined;
    if (Array.isArray(metadata.tracks)) {
      // Audio tracks are NOT listed here: the HLS master carries them as EXT-X-MEDIA renditions and hls.js
      // exposes/switches them natively. Only external subtitle tracks need the plugin↔backend windowed path.
      subtitles = metadata.tracks
        .filter(t => t.type === 'subtitle')
        .map((t, i) => {
          const rel = (typeof t.relIndex === 'number') ? t.relIndex : i;
          const codec = (t.codec || '').toLowerCase();
          const format = (codec === 'ass' || codec === 'ssa') ? 'ass' : 'vtt';
          return {
            id: String(rel),
            // Base URL only — the player appends `?format=&start=<bucket>` per window.
            src: TorrentParser.buildSubtitleBaseUrl(cleanTorrUrl, hash, fileIndex, rel),
            label: buildSubtitleLabel(t, i),
            language: t.language || t.languageCode || '',
            format,
          };
        });
    }
    return { duration, subtitles };
  } catch (err) {
    console.error("TorrentGo metadata unavailable, degrading to default track:", err);
    return {};
  }
}

PotokSDK.streams.registerStreamSource({
  id: "potok-torrents",
  name: PotokSDK.i18n.t("potok-torrents:manifest.name"),
  supportedTypes: ["movie", "tv"],

  async search(query) {
    const absoluteSearchEngine = await resolveSearchEngineUrl();
    if (!absoluteSearchEngine) {
      throw new Error(PotokSDK.i18n.t("potok-torrents:errors.noSearchUrl"));
    }

    const url = `${absoluteSearchEngine}/api/v1/torrents/search`;
    const body = {
      query: query.title,
      mediaType: query.type === "tv" ? "tv" : "movie",
      id: Number(query.tmdbId),
      season: query.season,
      episode: query.episode,
      forceSearch: !!query.forceSearch
    };

    const res = await PotokSDK.http.post(url, body);
    if (res.status !== 200) {
      throw new Error(`Status code: ${res.status}`);
    }
    const data = JSON.parse(res.data);
    // Drop fuzzy garbage (different shows SearchEngine matched on a shared word) before mapping, so the
    // sources list only shows real matches for the searched title.
    const results = filterRelevantResults(data.results || [], query.title);

    let mappedResults = results.map(t => {
      const hash = (t.id || "").toLowerCase();
      const baseTorrent = {
        title: t.title,
        url: t.link,
        magnet: t.magnetUri,
        sizeBytes: typeof t.sizeBytes === "number" ? t.sizeBytes : undefined,
        size: typeof t.sizeBytes === "number" ? t.sizeBytes : undefined,
        sizeLabel: t.sizeLabel || "",
        seeders: typeof t.seeders === "number" ? t.seeders : 0,
        seeds: typeof t.seeders === "number" ? t.seeders : 0,
        leechers: typeof t.leechers === "number" ? t.leechers : 0,
        peers: typeof t.leechers === "number" ? t.leechers : 0,
        tracker: t.tracker || "SearchEngine",
        provider: t.tracker || "SearchEngine",
        tags: Array.isArray(t.tags) ? [...t.tags] : [],
        publishDate: t.publishDate || "",
        hash: hash,
        kind: "torrent"
      };

      // Enrich from the FULL title with the local regex parser — NOT parseEpisode, which path-splits on "/",
      // but in a release title "/" separates LANGUAGES, not folders (the season/OVA marker often lives in the
      // first language segment, e.g. "(ОВА-3) / … / [OVA]"). extractSeasonEpisode reads the whole string:
      // season/episode (range-aware), kind (tv/ova/movie) + OVA number. Plus cheap quality tags. Deterministic,
      // offline, no tokens. Season 0 never leaks into a filter bucket; OVAs are not TV seasons.
      const parsed = TorrentParser.extractSeasonEpisode(t.title);
      baseTorrent.parsedKind = parsed.kind;
      baseTorrent.ovaNumber = parsed.ovaNumber;
      baseTorrent.season = (Number.isInteger(parsed.season) && parsed.season > 0) ? parsed.season : undefined;
      baseTorrent.seasons = (parsed.seasons && parsed.seasons.length > 0)
        ? parsed.seasons
        : (baseTorrent.season !== undefined ? [baseTorrent.season] : undefined);
      baseTorrent.episode = parsed.episode;

      const quality = TorrentParser.extractQualityTags(t.title);
      baseTorrent.resolution = quality.resolution;
      baseTorrent.codec = quality.codec;
      baseTorrent.year = quality.year;

      const tagsSet = new Set(baseTorrent.tags);
      if (quality.resolution) tagsSet.add(quality.resolution);
      if (quality.codec) tagsSet.add(quality.codec.toUpperCase());
      if (quality.year) tagsSet.add(String(quality.year));
      if (parsed.kind === "ova") tagsSet.add(parsed.ovaNumber ? "OVA-" + parsed.ovaNumber : "OVA");
      else if (parsed.kind === "movie") tagsSet.add("Movie");
      baseTorrent.tags = Array.from(tagsSet);

      return baseTorrent;
    });

    // If query requires a specific season, perform pre-filtering
    if (query.season !== undefined && query.season !== null) {
      const targetSeason = Number(query.season);
      mappedResults = mappedResults.filter(t => {
        if (t.parsedKind === "ova") {
          // OVAs/specials aren't TV seasons: an OVA-N shows ONLY under its associated Season N; a number-less
          // OVA under no specific season (still visible in the "All seasons" view). Fixes the cross-bucket leak.
          return t.ovaNumber === targetSeason;
        }
        if (t.seasons) {
          return t.seasons.includes(targetSeason);
        }
        if (t.season !== undefined && t.season !== null) {
          return t.season === targetSeason;
        }
        return true; // genuinely season-less TV release → keep (rare uploads)
      });
    }

    return mappedResults;
  },

  async getEpisodes(stream, context) {
    const hash = cleanHash(stream.hash || stream.url || stream.magnet || "torrent-id");
    const magnetUri = stream.magnet || "";
    const link = stream.url || "";

    const cleanTorrUrl = await resolveTorrUrl();
    if (!cleanTorrUrl) {
      throw new Error(PotokSDK.i18n.t("potok-torrents:errors.noTorrUrl"));
    }

    const requestBody = {
      title: stream.title,
      link: link,
      magnetUri: magnetUri,
      mediaType: context.type,
      tmdbId: Number(context.tmdbId)
    };

    const filesUrl = `${cleanTorrUrl.replace(/\/$/, "")}/api/torrents`;
    // Overrides now live in the SearchEngine (moved out of the gateway). Fetch the per-season map directly there
    // (absolute URL, like search); if no SearchEngine is configured, skip overrides gracefully.
    const searchEngineUrl = await resolveSearchEngineUrl();
    const overridePromise = searchEngineUrl
      ? PotokSDK.http.get(`${searchEngineUrl}/api/v1/torrents/overrides/${hash}`).catch(() => null)
      : Promise.resolve(null);

    const [filesResponse, overrideRes, detailRes] = await Promise.all([
      PotokSDK.http.post(filesUrl, requestBody),
      overridePromise,
      PotokSDK.http.get(`/api/media/detail/${context.type === "tv" ? "tv" : "movie"}/${context.tmdbId}`).catch(() => null)
    ]);

    if (filesResponse.status !== 200) {
      throw new Error(PotokSDK.i18n.t("potok-torrents:errors.torrGoError", { status: filesResponse.status }));
    }

    const resJson = typeof filesResponse.data === 'string' ? JSON.parse(filesResponse.data) : filesResponse.data;
    const rawFiles = resJson.items || [];
    const authHash = cleanHash(resJson.hash) || hash;
    if (rawFiles.length === 0) {
      throw new Error(PotokSDK.i18n.t("potok-torrents:errors.noMediaFiles"));
    }

    // seasonMap: { "<sourceSeason>": { season: <targetSeason>, offset }, "_": {...} } — sentinel "_" = files with
    // no parseable season. An entry REPLACES the auto-parse for that source season (it never stacks on it).
    let seasonMap = {};
    if (overrideRes && overrideRes.status === 200) {
      const data = typeof overrideRes.data === 'string' ? JSON.parse(overrideRes.data) : overrideRes.data;
      seasonMap = (data && data.seasonMap) || {};
    }

    let loadedTotalSeasons = 1;
    if (detailRes && detailRes.status === 200) {
      const details = typeof detailRes.data === 'string' ? JSON.parse(detailRes.data) : detailRes.data;
      loadedTotalSeasons = details.numberOfSeasons || 1;
    }

    // Per-SOURCE-season remap. Parse each file by NAME only (no override), group by its RAW source-season key
    // (sentinel "_" = no season), then apply the map entry for that key: displayedEpisode = parsedEpisode + offset.
    // The offset was computed by the UI on RAW parsed episodes (offset = targetEp − rawFirstEp), so it never
    // compounds. Files with no parsed episode fall back to sequential numbering WITHIN their key group. Each file
    // carries its RAW parsed season/episode so the UI can recompute a per-season offset without compounding.
    const SENTINEL = "_";
    const groupCounts = {};
    const refinedFiles = rawFiles.map((file) => {
      let filePath = file.path || file.title || "";
      if (!filePath.includes("/")) {
        filePath = stream.title ? `${stream.title}/${filePath}` : filePath;
      }
      const parsed = TorrentParser.parseEpisode(filePath, context.type, context.type === "tv" ? loadedTotalSeasons : undefined);
      const key = parsed.season !== undefined ? String(parsed.season) : SENTINEL;
      const idxInGroup = (groupCounts[key] = (groupCounts[key] ?? 0));
      groupCounts[key] = idxInGroup + 1;

      const entry = seasonMap[key];
      let season, episode;
      if (entry) {
        season = entry.season;
        episode = parsed.episode !== undefined ? parsed.episode + entry.offset : (1 + entry.offset + idxInGroup);
      } else {
        season = parsed.season !== undefined ? parsed.season : (context.type === "tv" ? 1 : 0);
        episode = parsed.episode !== undefined ? parsed.episode : (1 + idxInGroup);
      }
      return {
        ...file,
        season,
        episode,
        rawSeason: parsed.season,
        rawEpisode: parsed.episode,
        // Keep the ORIGINAL file name before cleanTitles trims it / applyTMDBMetadata overwrites `title`.
        fileName: file.title || (file.path ? file.path.split("/").pop() : undefined),
        isSerial: parsed.isSerial
      };
    });

    const cleanedFiles = TorrentParser.cleanTitles(refinedFiles);

    let mappedEpisodes = cleanedFiles.map((f) => {
      const streamUrl = TorrentParser.buildHlsUrl(cleanTorrUrl, authHash, String(f.id));

      const fileLabel = PotokSDK.i18n.t("potok-torrents:ui.file");
      return {
        id: String(f.id),
        season: f.season,
        episode: f.episode,
        rawSeason: f.rawSeason,
        rawEpisode: f.rawEpisode,
        title: f.title || `${fileLabel} ${f.id}`,
        fileName: f.fileName,
        isWatched: false,
        torrentHash: authHash,
        url: streamUrl
      };
    });

    mappedEpisodes = await applyTMDBMetadata(mappedEpisodes, context.tmdbId, context.type);

    return {
      episodes: mappedEpisodes,
      tmdbSeasonsCount: loadedTotalSeasons,
      seasonMap
    };
  },

  async getSeasonsMetadata(stream, context) {
    const detailRes = await PotokSDK.http.get(`/api/media/detail/${context.type === "tv" ? "tv" : "movie"}/${context.tmdbId}`);
    const details = typeof detailRes.data === 'string' ? JSON.parse(detailRes.data) : detailRes.data;
    const totalSeasons = details.numberOfSeasons || 1;

    const promises = [];
    for (let i = 1; i <= totalSeasons; i++) {
      promises.push(
        PotokSDK.http.get(`/api/media/tmdb/tv/${context.tmdbId}/season/${i}`)
          .then(res => typeof res.data === 'string' ? JSON.parse(res.data) : res.data)
          .catch(() => ({ seasonNumber: i, episodes: [] }))
      );
    }
    return Promise.all(promises);
  },

  // Upsert ONE source-season's mapping into the SearchEngine per-season override. sourceSeason may be null (the
  // sentinel bucket for files with no parseable season). offset is computed by the UI on RAW parsed episodes.
  async saveSeasonOverride(stream, context, sourceSeason, targetSeason, offset) {
    const hash = cleanHash(stream.hash || stream.url || stream.magnet || "torrent-id");
    const searchEngineUrl = await resolveSearchEngineUrl();
    if (!searchEngineUrl) {
      throw new Error(PotokSDK.i18n.t("potok-torrents:errors.noSearchUrl"));
    }
    const saveRes = await PotokSDK.http.post(`${searchEngineUrl}/api/v1/torrents/overrides/${hash}/season`, {
      sourceSeason: sourceSeason === undefined ? null : sourceSeason,
      targetSeason: targetSeason,
      offset: offset
    });
    if (saveRes.status !== 200) {
      throw new Error(`Save override failed with status ${saveRes.status}`);
    }
  },

  // Reset ONE source season's override (delete the entry → that season falls back to auto-parse).
  async clearSeasonOverride(stream, context, sourceSeason) {
    const hash = cleanHash(stream.hash || stream.url || stream.magnet || "torrent-id");
    const searchEngineUrl = await resolveSearchEngineUrl();
    if (!searchEngineUrl) {
      throw new Error(PotokSDK.i18n.t("potok-torrents:errors.noSearchUrl"));
    }
    const q = (sourceSeason === undefined || sourceSeason === null) ? "" : `?sourceSeason=${encodeURIComponent(sourceSeason)}`;
    const res = await PotokSDK.http.post(`${searchEngineUrl}/api/v1/torrents/overrides/${hash}/season/remove${q}`, {});
    if (res.status !== 200) {
      throw new Error(`Reset override failed with status ${res.status}`);
    }
  },

  async getPlaybackInfo(stream, episode, context) {
    // Return INSTANTLY: everything here is derived synchronously from the stream/episode (no /metadata probe),
    // so the player opens immediately with its waiting overlay. Subtitles + duration are DEFERRED to
    // getPlaybackMetadata and merged into the live descriptor by the host once the (slow) probe resolves.
    const { hlsUrl, hasBackend, session, thumbnails, hash, fileIndex } = await resolvePlaybackBase(stream, episode);

    const base = {
      streamUrl: hlsUrl,
      streamType: "m3u8",
      mediaType: context.type,
      id: Number(context.tmdbId),
      torrentHash: hash,
      fileIndex,
      subtitles: undefined, // deferred → getPlaybackMetadata (player merges them in when they arrive)
      session,
      thumbnails,
      requiresBuffering: hasBackend, // torrent-backed streams warm up → show the loading/progress overlay
      duration: undefined,  // deferred → getPlaybackMetadata (the HLS manifest also provides it to the player)
    };

    if (context.type === "tv") {
      const showTitle = context.title || stream.title || PotokSDK.i18n.t("potok-torrents:ui.serial");
      const seasonNum = episode && episode.season !== undefined ? episode.season : 1;
      const episodeNum = episode && episode.episode !== undefined ? episode.episode : 1;
      const episodeLabel = PotokSDK.i18n.t("potok-torrents:ui.episode");
      const episodeTitle = (episode && episode.title) || `${episodeLabel} ${episodeNum}`;
      const cleanEpisodeTitle = episodeTitle.replace(/^\d+[\s.\-_]+/, "").trim();
      return {
        ...base,
        title: `${showTitle} - S${seasonNum}E${episodeNum} - ${cleanEpisodeTitle}`,
        season: seasonNum,
        episode: episodeNum,
      };
    }
    return {
      ...base,
      title: context.title || stream.title || PotokSDK.i18n.t("potok-torrents:ui.video"),
    };
  },

  // Deferred slow half of the descriptor: probe TorrentGo /metadata for subtitle tracks + duration. The host
  // calls this right after opening the player, then merges the result into the live playback (the host owns
  // the descriptor state; the player is already reactive to late subtitles/duration).
  async getPlaybackMetadata(stream, episode, context) {
    const { cleanTorrUrl, fileIndex, hash } = await resolvePlaybackBase(stream, episode);
    return await fetchPlaybackMetadata(cleanTorrUrl, hash, fileIndex);
  }
});

// Register the modular sidebar status service
registerSidebarStatus();

// Register slot contribution for "Смотреть" button
PotokSDK.registerSlotContribution({
  id: "torrents-media-actions",
  slotName: "media-actions",
  render(props) {
    const watchText = PotokSDK.i18n.t("potok-torrents:manifest.watch");
    return {
      label: watchText,
      layout: PotokSDK.ui.components.Button(watchText)
        .variant("watch-primary")
        .onClick(() => {
          PotokSDK.ui.navigateTo(`/media/${props.mediaType}/${props.mediaId}/watch/potok-torrents`, {
            media: props.media,
            season: props.season,
            episode: props.episode
          });
        })
    };
  }
});
