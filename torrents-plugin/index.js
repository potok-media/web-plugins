import { PotokSDK } from 'potok-sdk';
import { TorrentParser } from './utils/parser.js';
import { registerSidebarStatus } from './utils/status.js';
import { applyTMDBMetadata } from './utils/metadata.js';

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
    let searchEngineBase = await PotokSDK.storage.local.getItem("searchEngineURL");
    if (searchEngineBase === null) {
      searchEngineBase = PotokSDK.config.searchEngineURL || "";
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
      forceSearch: false
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

    let torrUrl = await PotokSDK.storage.local.getItem("torrentGoURL");
    if (torrUrl === null) {
      torrUrl = PotokSDK.config.playerServerURL || PotokSDK.config.torrentGoURL || "";
    }
    const cleanTorrUrl = torrUrl.trim();
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

    const filesUrl = `${cleanTorrUrl.replace(/\/$/, "")}/api/torrent/files`;
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
      const streamUrlParams = {
        baseUrl: cleanTorrUrl,
        hash: hash,
        index: String(f.id),
        originalPath: f.path,
        mediaType: context.type,
        season: f.season,
        episode: f.episode,
        title: stream.title,
        tmdbId: Number(context.tmdbId)
      };

      let streamUrl = TorrentParser.generateStreamUrl(streamUrlParams);
      const ext = TorrentParser.getFileExtension(f.path);
      if (ext.toLowerCase() === ".mkv") {
        streamUrl += "?remux=true";
      }

      return {
        id: String(f.id),
        season: f.season !== undefined ? f.season : (context.type === "tv" ? 1 : 0),
        episode: f.episode !== undefined ? f.episode : 1,
        title: f.title || `Файл ${f.id}`,
        isWatched: false,
        audios: [{ id: "default", name: "Основной поток", url: streamUrl }],
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
    if (context.type === "tv") {
      return {
        streamUrl: episode.url,
        title: `${context.title || stream.title} - ${episode.title}`,
        mediaType: context.type,
        id: context.tmdbId,
        season: episode.season,
        episode: episode.episode,
        torrentHash: hash
      };
    }
    return {
      streamUrl: stream.url || stream.streamUrl || "",
      title: stream.title || "Видео",
      mediaType: context.type,
      id: context.tmdbId,
      torrentHash: hash
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
    const isTv = props.mediaType === "tv";
    const label = isTv && props.season && props.episode
      ? `Смотреть С${props.season}:Е${props.episode}`
      : "Смотреть";
    return {
      label: "Смотреть",
      layout: PotokSDK.ui.components.Button(label)
        .variant("watch-primary")
        .onClick(() => {
          PotokSDK.ui.navigateTo(`/media/${props.mediaType}/${props.mediaId}/watch/potok-torrents`, {
            season: props.season,
            episode: props.episode
          });
        })
    };
  }
});
