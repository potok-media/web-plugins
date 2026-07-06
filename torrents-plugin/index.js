import { PotokSDK } from 'potok-sdk';
import { TorrentParser } from './utils/parser.js';
import { registerSidebarStatus } from './utils/status.js';
import { applyTMDBMetadata } from './utils/metadata.js';
import { resolveTorrUrl } from './utils/config.js';
import { batchParseMetadata } from './utils/ai.js';

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
        searchEngineUrl: "SearchEngine Address",
        enableAi: "Enable AI Metadata Parsing",
        aiProvider: "AI Provider",
        aiApiKey: "API Key",
        aiApiKeyHint: "Get free API Key on <a href=\"https://console.groq.com/keys\" target=\"_blank\">Groq Console</a> or <a href=\"https://platform.openai.com/api-keys\" target=\"_blank\">OpenAI Platform</a>. Your keys are stored locally on your device, the code is open source and completely secure (<a href=\"https://github.com/egorrrmiller/potok\" target=\"_blank\">view source code</a>).",
        aiModel: "Model Name",
        aiEndpoint: "Custom API URL",
        aiCustomNoticeText: "⚠️ Custom LLM providers or models (such as Gemini, Claude, or OpenRouter) may block requests or return empty responses due to strict content safety policies regarding copyrighted titles."
      },
      errors: {
        noSearchUrl: "SearchEngine address is not configured.",
        noTorrUrl: "TorrentGo address is not configured.",
        aiFailed: "AI parsing failed: {{error}}",
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
        aiActive: "AI parsing active",
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
        searchEngineUrl: "Адрес SearchEngine",
        enableAi: "Включить ИИ-распознавание метаданных",
        aiProvider: "Провайдер ИИ",
        aiApiKey: "API-ключ",
        aiApiKeyHint: "Получите бесплатный ключ в <a href=\"https://console.groq.com/keys\" target=\"_blank\">Groq Console</a> или <a href=\"https://platform.openai.com/api-keys\" target=\"_blank\">OpenAI</a>. Ваши ключи хранятся локально на вашем устройстве, код полностью открыт и безопасен (<a href=\"https://github.com/egorrrmiller/potok\" target=\"_blank\">посмотреть исходный код</a>).",
        aiModel: "Имя модели",
        aiEndpoint: "Кастомный API URL",
        aiCustomNoticeText: "⚠️ Кастомные провайдеры или модели (например, Gemini, Claude, OpenRouter) могут блокировать запросы или возвращать пустые ответы из-за строгой политики безопасности в отношении защищенных авторским правом названий."
      },
      errors: {
        noSearchUrl: "Адрес поисковика SearchEngine не настроен.",
        noTorrUrl: "Адрес торрент-плеера TorrentGo не настроен.",
        aiFailed: "Ошибка ИИ-парсинга: {{error}}",
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
        aiActive: "ИИ-парсинг активен",
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

PotokSDK.streams.registerStreamSource({
  id: "potok-torrents",
  name: PotokSDK.i18n.t("potok-torrents:manifest.name"),
  supportedTypes: ["movie", "tv"],

  async search(query) {
    let searchEngineBase = PotokSDK.config.searchEngineURL || "";
    if (!searchEngineBase) {
      searchEngineBase = await PotokSDK.storage.local.getItem("searchEngineURL") || "";
    }
    let absoluteSearchEngine = searchEngineBase.trim();
    if (!absoluteSearchEngine) {
      throw new Error(PotokSDK.i18n.t("potok-torrents:errors.noSearchUrl"));
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

    // Load AI configurations
    const enableAi = await PotokSDK.storage.local.getItem("enableAiParsing") === "true";
    const aiProvider = await PotokSDK.storage.local.getItem("aiProvider") || "groq";
    const aiApiKey = await PotokSDK.storage.local.getItem("aiApiKey") || "";
    const aiModelName = await PotokSDK.storage.local.getItem("aiModelName") || "llama-3.1-8b-instant";
    const aiCustomEndpoint = await PotokSDK.storage.local.getItem("aiCustomEndpoint") || "";

    let aiParsedMetadata = null;
    if (enableAi && aiApiKey && results.length > 0) {
      const batchItems = results.map(t => ({ id: (t.id || "").toLowerCase(), title: t.title }));
      aiParsedMetadata = await batchParseMetadata(batchItems, { aiProvider, aiApiKey, aiModelName, aiCustomEndpoint });
    }

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

      // Enrich metadata
      const aiMeta = aiParsedMetadata ? aiParsedMetadata.find(m => m.id === hash) : null;
      if (aiMeta) {
        baseTorrent.seasons = Array.isArray(aiMeta.seasons) ? aiMeta.seasons : (aiMeta.season !== undefined && aiMeta.season !== null ? [aiMeta.season] : undefined);
        baseTorrent.season = (baseTorrent.seasons && baseTorrent.seasons.length > 0) ? baseTorrent.seasons[0] : undefined;
        baseTorrent.episodeStart = aiMeta.episodeStart;
        baseTorrent.episodeEnd = aiMeta.episodeEnd;
        baseTorrent.resolution = aiMeta.resolution;
        baseTorrent.codec = aiMeta.codec;
        baseTorrent.voice = Array.isArray(aiMeta.audio) ? aiMeta.audio.join(", ") : undefined;
        baseTorrent.subtitles = Array.isArray(aiMeta.subtitles) ? aiMeta.subtitles : undefined;
        baseTorrent.year = aiMeta.year;

        // Enrich tags with new parsed metadata
        const tagsSet = new Set(baseTorrent.tags);
        if (aiMeta.resolution) tagsSet.add(aiMeta.resolution);
        if (aiMeta.codec) tagsSet.add(aiMeta.codec.toUpperCase());
        if (Array.isArray(aiMeta.audio)) aiMeta.audio.forEach(a => tagsSet.add(a));
        if (aiMeta.year) tagsSet.add(String(aiMeta.year));
        baseTorrent.tags = Array.from(tagsSet);
      } else {
        // Fallback: use local regex parser
        const parsed = TorrentParser.parseEpisode(t.title, query.type, undefined, undefined, undefined, 0);
        baseTorrent.season = parsed.season;
        baseTorrent.seasons = parsed.season !== undefined ? [parsed.season] : undefined;
        baseTorrent.episode = parsed.episode;
      }

      return baseTorrent;
    });

    // If query requires a specific season, perform pre-filtering
    if (query.season !== undefined && query.season !== null) {
      const targetSeason = Number(query.season);
      mappedResults = mappedResults.filter(t => {
        if (t.seasons) {
          return t.seasons.includes(targetSeason);
        }
        if (t.season !== undefined && t.season !== null) {
          return t.season === targetSeason;
        }
        return true; // Keep unspecified releases so users don't miss rare uploads
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
    const [filesResponse, overrideRes, detailRes] = await Promise.all([
      PotokSDK.http.post(filesUrl, requestBody),
      PotokSDK.http.get(`/api/media/override/${hash}`).catch(() => ({ status: 404 })),
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
      const streamUrl = TorrentParser.buildHlsUrl(cleanTorrUrl, authHash, String(f.id));

      const fileLabel = PotokSDK.i18n.t("potok-torrents:ui.file");
      return {
        id: String(f.id),
        season: f.season !== undefined ? f.season : (context.type === "tv" ? 1 : 0),
        episode: f.episode !== undefined ? f.episode : 1,
        title: f.title || `${fileLabel} ${f.id}`,
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

// Initialize Custom LLM provider warning banner on load if conditions are met
(async function initSettingsNotice() {
  try {
    const aiProvider = await PotokSDK.storage.local.getItem("aiProvider") || "groq";
    const currentNotice = await PotokSDK.storage.local.getItem("aiProviderNotice") || "";
    
    if (aiProvider === "custom") {
      const warningText = PotokSDK.i18n.t("potok-torrents:config.aiCustomNoticeText");
      if (currentNotice !== warningText) {
        await PotokSDK.storage.local.setItem("aiProviderNotice", warningText);
      }
    } else {
      if (currentNotice !== "") {
        await PotokSDK.storage.local.setItem("aiProviderNotice", "");
      }
    }
  } catch (e) {
    console.error("Failed to init settings notice:", e);
  }
})();

// Dynamic AI settings autofill managed by the plugin itself
PotokSDK.onSettingsChanged((key, val, currentSettings) => {
  const updates = {};
  
  if (key === "aiProvider") {
    const currentModel = currentSettings.aiModelName;
    const currentEndpoint = currentSettings.aiCustomEndpoint;

    const isGroqModel = !currentModel || currentModel === "llama-3.1-8b-instant" || currentModel === "";
    const isGroqEndpoint = !currentEndpoint || currentEndpoint === "https://api.groq.com/openai/v1" || currentEndpoint === "";

    const isOpenAiModel = currentModel === "gpt-4o-mini";
    const isOpenAiEndpoint = currentEndpoint === "https://api.openai.com/v1";

    if (val === "groq") {
      if (isOpenAiModel || !currentModel) {
        updates.aiModelName = "llama-3.1-8b-instant";
      }
      if (isOpenAiEndpoint || !currentEndpoint) {
        updates.aiCustomEndpoint = "https://api.groq.com/openai/v1";
      }
    } else if (val === "openai") {
      if (isGroqModel || !currentModel) {
        updates.aiModelName = "gpt-4o-mini";
      }
      if (isGroqEndpoint || !currentEndpoint) {
        updates.aiCustomEndpoint = "https://api.openai.com/v1";
      }
    } else if (val === "custom") {
      if (isGroqModel || isOpenAiModel) {
        updates.aiModelName = "";
      }
      if (isGroqEndpoint || isOpenAiEndpoint) {
        updates.aiCustomEndpoint = "";
      }
    }
  }

  // Update Custom warning notice dynamically
  const provider = key === "aiProvider" ? val : currentSettings.aiProvider;
  
  if (provider === "custom") {
    const warningText = PotokSDK.i18n.t("potok-torrents:config.aiCustomNoticeText");
    if (currentSettings.aiProviderNotice !== warningText) {
      updates.aiProviderNotice = warningText;
    }
  } else {
    if (currentSettings.aiProviderNotice !== "") {
      updates.aiProviderNotice = "";
    }
  }

  if (Object.keys(updates).length > 0) {
    PotokSDK.updateSettingsForm(updates);
  }
});
