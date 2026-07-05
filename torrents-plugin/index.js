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
      // Hand the player the READY HLS master URL (no more progressive `?remux=true` marker for the
      // player to reverse-engineer). This `url` is only an identity/placeholder anyway — the full
      // playback descriptor (audios/subtitles/session) is built per-episode in getPlaybackInfo.
      const streamUrl = TorrentParser.buildHlsUrl(cleanTorrUrl, hash, String(f.id));

      return {
        id: String(f.id),
        season: f.season !== undefined ? f.season : (context.type === "tv" ? 1 : 0),
        episode: f.episode !== undefined ? f.episode : 1,
        title: f.title || `Файл ${f.id}`,
        isWatched: false,
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
    const hash = cleanHash(stream.hash || stream.url || stream.magnet || "torrent-id");

    const cleanTorrUrl = await resolveTorrUrl();
    const fileIndex = String(episode && episode.id != null ? episode.id : "");

    // The player is provider-agnostic: it plays whatever streamUrl + streamType we hand it, renders the
    // audio/subtitle tracks we list, and drives the session heartbeat against the URLs we give. So build
    // the FULL ready descriptor here (this is the plugin↔TorrentGo boundary, not the player's job).
    const hlsUrl = (cleanTorrUrl && fileIndex)
      ? TorrentParser.buildHlsUrl(cleanTorrUrl, hash, fileIndex)
      : ((episode && episode.url) || stream.url || stream.streamUrl || "");

    let duration = undefined;
    let introStart = undefined;
    let introEnd = undefined;
    let outroStart = undefined;
    let outroEnd = undefined;
    let subtitles = undefined;
    let audios = undefined;

    if (cleanTorrUrl && fileIndex) {
      try {
        const metadataUrl = `${cleanTorrUrl}/api/torrents/${hash.toLowerCase()}/files/${fileIndex}/metadata`;
        const metadataResponse = await PotokSDK.http.get(metadataUrl);
        if (metadataResponse && metadataResponse.status === 200) {
          const metadata = typeof metadataResponse.data === 'string' ? JSON.parse(metadataResponse.data) : metadataResponse.data;
          if (metadata) {
            duration = metadata.duration;
            introStart = metadata.introStart;
            introEnd = metadata.introEnd;
            outroStart = metadata.outroStart;
            outroEnd = metadata.outroEnd;

            if (metadata.tracks && Array.isArray(metadata.tracks)) {
              // Audio: one HLS producer is muxed per track (absolute stream index `-map 0:N`). The FIRST
              // audio maps to the plain HLS URL (backend `0:a:0?`, keepalive audio="") so it never spawns
              // a duplicate producer; the rest carry `?audio=<absIndex>`.
              const audioTracks = metadata.tracks.filter(t => t.type === 'audio');
              if (audioTracks.length > 0) {
                audios = audioTracks.map((t, i) => ({
                  id: String(t.index),
                  name: t.title || t.name || t.label || `Дорожка ${i + 1}`,
                  url: i === 0 ? hlsUrl : TorrentParser.buildAudioUrl(hlsUrl, t.index),
                }));
              }

              subtitles = metadata.tracks
                .filter(t => t.type === 'subtitle')
                .map(t => {
                  const codec = (t.codec || '').toLowerCase();
                  const format = (codec === 'ass' || codec === 'ssa') ? 'ass' : 'vtt';
                  // Base URL only — the player appends `?format=&start=<bucket>` per 15s window.
                  const src = TorrentParser.buildSubtitleBaseUrl(cleanTorrUrl, hash, fileIndex, t.relIndex);
                  return {
                    id: String(t.relIndex),
                    src,
                    label: t.label || t.title || t.name || `Subtitles #${t.relIndex}`,
                    language: t.language || t.languageCode || '',
                    format
                  };
                });
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch metadata from TorrentGo:", err);
      }
    }

    const session = (cleanTorrUrl && fileIndex)
      ? {
          keepaliveUrl: `${cleanTorrUrl}/api/playback/keepalive`,
          stopUrl: `${cleanTorrUrl}/api/playback/stop`,
          intervalSec: 7,
          hash: hash.toLowerCase(),
          file: fileIndex,
        }
      : undefined;

    const base = {
      streamUrl: hlsUrl,
      streamType: "m3u8",
      mediaType: context.type,
      id: Number(context.tmdbId),
      torrentHash: hash,
      fileIndex,
      audios,
      subtitles,
      session,
      duration,
      introStart,
      introEnd,
      outroStart,
      outroEnd,
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
