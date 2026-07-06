import { PotokSDK } from 'potok-sdk';
import { TorrentParser } from './utils/parser.js';
import { registerSidebarStatus } from './utils/status.js';
import { applyTMDBMetadata } from './utils/metadata.js';
import { resolveTorrUrl } from './utils/config.js';

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

// Best-effort human language name from an ISO code (falls back to the code uppercased).
let _langDisplay;
function langName(code) {
  if (!code) return "";
  const c = String(code).trim();
  if (!c) return "";
  try {
    if (_langDisplay === undefined) {
      _langDisplay = (typeof Intl !== "undefined" && Intl.DisplayNames)
        ? new Intl.DisplayNames(["ru"], { type: "language" })
        : null;
    }
    if (_langDisplay) {
      const name = _langDisplay.of(c.toLowerCase());
      if (name && name.toLowerCase() !== c.toLowerCase()) {
        return name.charAt(0).toUpperCase() + name.slice(1);
      }
    }
  } catch (e) { /* ignore */ }
  const table = { rus: "Русский", ru: "Русский", eng: "Английский", en: "Английский", jpn: "Японский", ja: "Японский", ukr: "Украинский", uk: "Украинский" };
  return table[c.toLowerCase()] || c.toUpperCase();
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
  const primary = (title && !generic.test(title)) ? title : (lang || `Субтитры #${rel}`);
  return codec ? `${primary} (${codec})` : primary;
}

PotokSDK.streams.registerStreamSource({
  id: "potok-torrents",
  name: "Поиск торрентов",
  supportedTypes: ["movie", "tv"],

  async search(query) {
    let searchEngineBase = PotokSDK.config.searchEngineURL || "";
    if (!searchEngineBase) {
      searchEngineBase = await PotokSDK.storage.local.getItem("searchEngineURL") || "";
    }
    let absoluteSearchEngine = searchEngineBase.trim();
    if (!absoluteSearchEngine) {
      throw new Error("Адрес поисковика SearchEngine не настроен.");
    }
    if (!/^https?:\/\//i.test(absoluteSearchEngine)) {
      absoluteSearchEngine = `http://${absoluteSearchEngine}`;
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
    const results = data.results || [];

    return results.map(t => ({
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
      tags: t.tags || [],
      publishDate: t.publishDate || "",
      hash: (t.id || "").toLowerCase(),
      kind: "torrent"
    }));
  },

  async getEpisodes(stream, context) {
    const hash = cleanHash(stream.hash || stream.url || stream.magnet || "torrent-id");
    const magnetUri = stream.magnet || "";
    const link = stream.url || "";

    const cleanTorrUrl = await resolveTorrUrl();
    if (!cleanTorrUrl) {
      throw new Error("Адрес торрент-плеера TorrentGo не настроен.");
    }

    const requestBody = {
      title: stream.title,
      link: link,
      magnetUri: magnetUri,
      mediaType: context.type,
      tmdbId: Number(context.tmdbId)
    };

    const filesUrl = `${cleanTorrUrl.replace(/\/$/, "")}/api/torrents`;
    const [filesResponse, overrideRes, detailRes] = await Promise.all([
      PotokSDK.http.post(filesUrl, requestBody),
      PotokSDK.http.get(`/api/media/override/${hash}`).catch(() => ({ status: 404 })),
      PotokSDK.http.get(`/api/media/detail/${context.type === "tv" ? "tv" : "movie"}/${context.tmdbId}`).catch(() => null)
    ]);

    if (filesResponse.status !== 200) {
      throw new Error(`Ошибка TorrentGo (статус ${filesResponse.status})`);
    }

    const resJson = typeof filesResponse.data === 'string' ? JSON.parse(filesResponse.data) : filesResponse.data;
    const rawFiles = resJson.items || [];
    // AUTHORITATIVE infohash from the backend (`POST /api/torrents` → `hash`). Used for ALL TorrentGo URLs
    // + descriptor identity. The BFF override namespace above deliberately keeps the search-derived `hash`.
    const authHash = cleanHash(resJson.hash) || hash;
    if (rawFiles.length === 0) {
      throw new Error("В раздаче не найдено поддерживаемых медиафайлов.");
    }

    let override = null;
    if (overrideRes && overrideRes.status === 200) {
      override = typeof overrideRes.data === 'string' ? JSON.parse(overrideRes.data) : overrideRes.data;
    }

    let loadedTotalSeasons = 1;
    if (detailRes && detailRes.status === 200) {
      const details = typeof detailRes.data === 'string' ? JSON.parse(detailRes.data) : detailRes.data;
      loadedTotalSeasons = details.numberOfSeasons || 1;
    }

    const refinedFiles = rawFiles.map((file, fileIdx) => {
      let filePath = file.path || file.title || "";
      if (!filePath.includes("/")) {
        filePath = stream.title ? `${stream.title}/${filePath}` : filePath;
      }
      const sOverride = override ? (override.season !== undefined ? override.season : override.Season) : undefined;
      const oOverride = override ? (
        override.episodeOffset !== undefined ? override.episodeOffset :
        override.EpisodeOffset !== undefined ? override.EpisodeOffset :
        override.episode_offset
      ) : undefined;

      const parsed = TorrentParser.parseEpisode(
        filePath,
        context.type,
        context.type === "tv" ? loadedTotalSeasons : undefined,
        sOverride,
        oOverride,
        fileIdx
      );
      return {
        ...file,
        season: parsed.season,
        episode: parsed.episode,
        isSerial: parsed.isSerial
      };
    });

    const cleanedFiles = TorrentParser.cleanTitles(refinedFiles);

    let mappedEpisodes = cleanedFiles.map((f) => {
      // READY HLS master URL, built with the AUTHORITATIVE hash. This `url` doubles as the carrier of that
      // hash — getPlaybackInfo recovers it from here if the host strips the `torrentHash` field. The full
      // playback descriptor (audios/subtitles/session) is built per-episode in getPlaybackInfo.
      const streamUrl = TorrentParser.buildHlsUrl(cleanTorrUrl, authHash, String(f.id));

      return {
        id: String(f.id),
        season: f.season !== undefined ? f.season : (context.type === "tv" ? 1 : 0),
        episode: f.episode !== undefined ? f.episode : 1,
        title: f.title || `Файл ${f.id}`,
        isWatched: false,
        torrentHash: authHash,
        url: streamUrl
      };
    });

    mappedEpisodes = await applyTMDBMetadata(mappedEpisodes, context.tmdbId, context.type);

    return {
      episodes: mappedEpisodes,
      tmdbSeasonsCount: loadedTotalSeasons
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

  async saveMetadataOverride(stream, context, seasonNum, episodeOffset) {
    const hash = cleanHash(stream.hash || stream.url || stream.magnet || "torrent-id");
    const saveRes = await PotokSDK.http.post(`/api/media/override`, {
      hash: hash,
      override: {
        season: seasonNum,
        episodeOffset: episodeOffset
      }
    });
    if (saveRes.status !== 200) {
      throw new Error(`BFF save override failed with status ${saveRes.status}`);
    }
  },

  async getPlaybackInfo(stream, episode, context) {
    const cleanTorrUrl = await resolveTorrUrl();
    const fileIndex = String(episode && episode.id != null ? episode.id : "");

    // Resolve the AUTHORITATIVE infohash robustly: threaded on the episode by getEpisodes, else recovered
    // from the episode URL it baked, else the search stream's own id. All TorrentGo URLs + descriptor
    // identity use this hash.
    const hash = cleanHash(
      (episode && episode.torrentHash) ||
      parseHashFromUrl(episode && episode.url) ||
      stream.hash || stream.url || stream.magnet || ""
    );

    // The player is provider-agnostic: it plays whatever streamUrl + streamType we hand it, renders the
    // tracks we list, and drives the session/status/thumbnails against the URLs we give. So build the FULL
    // ready descriptor here (this is the plugin↔TorrentGo boundary, not the player's job).
    const hlsUrl = (cleanTorrUrl && fileIndex)
      ? TorrentParser.buildHlsUrl(cleanTorrUrl, hash, fileIndex)
      : ((episode && episode.url) || stream.url || stream.streamUrl || "");

    let duration = undefined;
    let subtitles = undefined;

    if (cleanTorrUrl && fileIndex) {
      try {
        const metadataUrl = `${cleanTorrUrl}/api/torrents/${hash}/files/${fileIndex}/metadata`;
        const metadataResponse = await PotokSDK.http.get(metadataUrl);
        const metadata = (metadataResponse && metadataResponse.status === 200)
          ? (typeof metadataResponse.data === 'string' ? JSON.parse(metadataResponse.data) : metadataResponse.data)
          : null;

        if (metadata && typeof metadata.duration === 'number') {
          duration = metadata.duration;
        }

        if (metadata && Array.isArray(metadata.tracks)) {
          // Audio tracks are NOT listed here: the HLS master carries them as EXT-X-MEDIA renditions and
          // hls.js exposes/switches them natively (no per-track URLs, no source reload).
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
      } catch (err) {
        // Degraded path: no usable metadata → the default audio still plays off the plain HLS URL; the
        // player just shows no track menus. (Also covers a 504 METADATA_TIMEOUT surfaced from getEpisodes.)
        console.error("TorrentGo metadata unavailable, degrading to default track:", err);
      }
    }

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

    const base = {
      streamUrl: hlsUrl,
      streamType: "m3u8",
      mediaType: context.type,
      id: Number(context.tmdbId),
      torrentHash: hash,
      fileIndex,
      subtitles,
      session,
      thumbnails,
      requiresBuffering: hasBackend, // torrent-backed streams warm up → show the loading/progress overlay
      duration,
    };

    if (context.type === "tv") {
      const showTitle = context.title || stream.title || "Сериал";
      const seasonNum = episode && episode.season !== undefined ? episode.season : 1;
      const episodeNum = episode && episode.episode !== undefined ? episode.episode : 1;
      const episodeTitle = (episode && episode.title) || `Серия ${episodeNum}`;
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
      title: context.title || stream.title || "Видео",
    };
  }
});

// Register the modular sidebar status service
registerSidebarStatus();

// Register slot contribution for "Смотреть" button
PotokSDK.registerSlotContribution({
  id: "torrents-media-actions",
  slotName: "media-actions",
  render(props) {
    return {
      label: "Смотреть",
      layout: PotokSDK.ui.components.Button("Смотреть")
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
