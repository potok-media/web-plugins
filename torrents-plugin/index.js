import { PotokSDK } from 'potok-sdk';
import { TorrentParser } from './utils/parser.js';

const { Button, StreamList, VStack, HStack, Text, Badge } = PotokSDK.ui.components;

// Helper to extract hash from magnet link
function getHashFromMagnet(magnet) {
  if (!magnet) return null;
  try {
    const match = magnet.match(/xt=urn:btih:([^&/]+)/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

// Register slot contribution for the Details Page watch button
PotokSDK.registerSlotContribution({
  slotName: "media-actions",
  id: "torrents-media-actions",
  render: (props) => {
    const url = `/media/${props.mediaType}/${props.mediaId}/watch/potok-torrents` + 
      (props.season ? `?season=${props.season}&episode=${props.episode}` : "");

    return {
      label: "Смотреть",
      layout: Button("Смотреть")
        .variant("watch-primary")
        .onClick(() => {
          PotokSDK.ui.navigateTo(url);
        })
    };
  }
});

// Reactive state for the Streams Page Slot Sandbox
const streamsState = PotokSDK.createState({
  activeTab: "default", // "default" | "torrents" | "online"
  mediaId: null,
  mediaType: null,
  season: null,
  episode: null,
  title: "",
  torrents: [],
  loading: false,
  error: ""
});

// React to host streams page mount & contextual details broadcast
PotokSDK.ui.onBlockContextUpdate((blockName, context) => {
  const isStreamsBlock = ["media-streams-header", "media-streams-filters", "media-streams-results"].includes(blockName);
  if (isStreamsBlock && context) {
    const isNewContext = 
      streamsState.mediaId !== context.mediaId ||
      streamsState.mediaType !== context.mediaType ||
      streamsState.season !== context.season ||
      streamsState.episode !== context.episode;

    if (isNewContext) {
      streamsState.mediaId = context.mediaId;
      streamsState.mediaType = context.mediaType;
      streamsState.season = context.season;
      streamsState.episode = context.episode;
      streamsState.title = context.title || "";
    }

    const previousTab = streamsState.activeTab;
    if (context.tab) {
      streamsState.activeTab = context.tab;
    } else {
      streamsState.activeTab = "potok-torrents";
    }

    const tabChanged = previousTab !== streamsState.activeTab;

    if ((isNewContext || tabChanged) && streamsState.activeTab === "potok-torrents") {
      runTorrentsSearch();
    }
  }
});

// Fetch search results from Jackett/TorrServer/SearchEngine via the host gateway proxy
async function runTorrentsSearch(force = false) {
  if (!streamsState.mediaId) return;
  streamsState.loading = true;
  streamsState.torrents = [];
  streamsState.error = "";
  applyBlockMutations();

  let searchEngineBase = await PotokSDK.storage.local.getItem("searchEngineURL");
  if (searchEngineBase === null) {
    searchEngineBase = PotokSDK.config.searchEngineURL || "";
  }
  let absoluteSearchEngine = searchEngineBase.trim();
  if (!absoluteSearchEngine) {
    streamsState.loading = false;
    streamsState.error = "Адрес поисковика торрентов не настроен.";
    applyBlockMutations();
    return;
  }

  if (!/^https?:\/\//i.test(absoluteSearchEngine)) {
    absoluteSearchEngine = `http://${absoluteSearchEngine}`;
  }

  const url = `${absoluteSearchEngine}/api/v1/torrents/search`;
  const body = {
    query: streamsState.title,
    mediaType: streamsState.mediaType === "tv" ? "tv" : "movie",
    id: Number(streamsState.mediaId),
    season: streamsState.season,
    episode: streamsState.episode,
    forceSearch: force
  };

  try {
    const res = await PotokSDK.http.post(url, body);
    if (res.status !== 200) {
      throw new Error(`Status code: ${res.status}`);
    }
    const data = JSON.parse(res.data);
    const results = data.results || [];

    streamsState.torrents = results.map(t => ({
      title: t.title,
      url: t.link,
      magnet: t.magnetUri,
      quality: t.sizeLabel || "",
      size: typeof t.sizeBytes === "number" ? t.sizeBytes : undefined,
      seeds: t.seeders || 0,
      peers: t.leechers || 0,
      provider: t.tracker || "Jackett",
      hash: getHashFromMagnet(t.magnetUri || "") || getHashFromMagnet(t.link || "") || t.id,
      kind: "torrent"
    }));
  } catch (err) {
    console.error("[TorrentsPlugin] Jackett search failed:", err);
    streamsState.error = "Не удалось выполнить поиск раздач.";
  } finally {
    streamsState.loading = false;
    applyBlockMutations();
  }
}

// Clean hash matching SDK
function cleanHash(hash) {
  if (!hash) return "";
  return hash.replace(/^urn:btih:/i, "").split("&")[0].trim().toLowerCase();
}

// Handle select stream inside virtual list
async function handleSelectStream(stream) {
  const hash = cleanHash(stream.hash || stream.url || stream.magnet || "torrent-id");
  const magnetUri = stream.magnet || "";
  const link = stream.url || "";
  
  let torrUrl = await PotokSDK.storage.local.getItem("torrentGoURL");
  if (torrUrl === null) torrUrl = PotokSDK.config.torrentGoURL || "";
  const cleanTorrUrl = torrUrl.trim();
  if (!cleanTorrUrl) {
    PotokSDK.ui.showHUD("error", "Адрес торрент-плеера не настроен.");
    return;
  }

  PotokSDK.ui.showHUD("info", "Загрузка списка файлов...");
  
  // Show episode selector popup initially in loading state!
  PotokSDK.ui.showEpisodeSelector({
    title: stream.title,
    episodes: [],
    seasonsLoading: true
  });

  const requestBody = {
    title: stream.title,
    link: link,
    magnetUri: magnetUri,
    mediaType: streamsState.mediaType,
    tmdbId: Number(streamsState.mediaId)
  };

  try {
    const filesProxyUrl = `/api/proxy?url=${encodeURIComponent(`${cleanTorrUrl.replace(/\/$/, "")}/api/torrent/files`)}`;
    const filesResponse = await PotokSDK.http.post(filesProxyUrl, requestBody);
    if (filesResponse.status !== 200) {
      throw new Error(`Ошибка TorrServer (статус ${filesResponse.status})`);
    }

    const resJson = typeof filesResponse.data === 'string' ? JSON.parse(filesResponse.data) : filesResponse.data;
    const rawFiles = resJson.items || [];

    if (rawFiles.length === 0) {
      PotokSDK.ui.showEpisodeSelector({
        title: stream.title,
        episodes: [],
        seasonsLoading: false
      });
      PotokSDK.ui.showHUD("error", "В раздаче не найдено поддерживаемых медиафайлов.");
      return;
    }

    // Load override from BFF if available
    let override = null;
    try {
      const overrideRes = await PotokSDK.http.get(`/api/media/override/${hash}`);
      if (overrideRes.status === 200) {
        const oJson = typeof overrideRes.data === 'string' ? JSON.parse(overrideRes.data) : overrideRes.data;
        override = oJson.override || null;
      }
    } catch (e) {
      console.warn("[TorrentsPlugin] Failed to load override:", e);
    }

    // Parse and map files
    const parseAndMapFiles = (currentOverride) => {
      const refinedFiles = rawFiles.map((file, fileIdx) => {
        let filePath = file.path || file.title || "";
        if (!filePath.includes("/")) {
          filePath = stream.title ? `${stream.title}/${filePath}` : filePath;
        }
        const parsed = TorrentParser.parseEpisode(
          filePath,
          streamsState.mediaType,
          streamsState.mediaType === "tv" ? 99 : undefined,
          currentOverride?.season,
          currentOverride?.episodeOffset,
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

      return cleanedFiles.map((f) => {
        const streamUrlParams = {
          baseUrl: cleanTorrUrl,
          hash: hash,
          index: String(f.id),
          originalPath: f.path,
          mediaType: streamsState.mediaType,
          season: f.season,
          episode: f.episode,
          title: streamsState.title,
          tmdbId: Number(streamsState.mediaId)
        };

        let streamUrl = TorrentParser.generateStreamUrl(streamUrlParams);
        const ext = TorrentParser.getFileExtension(f.path);
        if (ext.toLowerCase() === ".mkv") {
          streamUrl += "?remux=true";
        }

        return {
          id: String(f.id),
          season: f.season !== undefined ? f.season : (streamsState.mediaType === "tv" ? 1 : 0),
          episode: f.episode !== undefined ? f.episode : 1,
          title: f.title || `Файл ${f.id}`,
          isWatched: false,
          audios: [{ id: "default", name: "Основной поток", url: streamUrl }],
          url: streamUrl
        };
      });
    };

    let mappedEpisodes = parseAndMapFiles(override);

    // Callbacks inside the plugin!
    const onPlay = (episode) => {
      PotokSDK.ui.playVideo({
        streamUrl: episode.url,
        title: `${streamsState.title} - ${episode.title}`,
        mediaType: streamsState.mediaType,
        id: streamsState.mediaId,
        season: episode.season,
        episode: episode.episode,
        torrentHash: hash
      });
      PotokSDK.ui.showHUD("success", "Запускаем воспроизведение...");
    };

    const onStartEditing = async () => {
      // Fetch seasons from TMDB via BFF proxy
      try {
        PotokSDK.ui.showEpisodeSelector({
          title: stream.title,
          episodes: mappedEpisodes,
          seasonsLoading: true
        });

        // 1. Fetch media details to get number of seasons
        const detailRes = await PotokSDK.http.get(`/api/media/detail/${streamsState.mediaType === "tv" ? "tv" : "movie"}/${streamsState.mediaId}`);
        const details = typeof detailRes.data === 'string' ? JSON.parse(detailRes.data) : detailRes.data;
        const totalSeasons = details.numberOfSeasons || 1;

        // 2. Fetch all seasons in parallel
        const promises = [];
        for (let i = 1; i <= totalSeasons; i++) {
          promises.push(
            PotokSDK.http.get(`/api/media/tmdb/tv/${streamsState.mediaId}/season/${i}`)
              .then(res => typeof res.data === 'string' ? JSON.parse(res.data) : res.data)
              .catch(() => ({ seasonNumber: i, episodes: [] }))
          );
        }

        const seasonsList = await Promise.all(promises);

        PotokSDK.ui.showEpisodeSelector({
          title: stream.title,
          episodes: mappedEpisodes,
          seasonsLoading: false,
          seasons: seasonsList,
          tmdbSeasonsCount: totalSeasons
        });
      } catch (err) {
        console.error("[TorrentsPlugin] Failed to load seasons metadata:", err);
        PotokSDK.ui.showHUD("error", "Не удалось загрузить данные сезонов с TMDB");
        PotokSDK.ui.showEpisodeSelector({
          title: stream.title,
          episodes: mappedEpisodes,
          seasonsLoading: false
        });
      }
    };

    const onApplyOverride = async (seasonNum, epNum) => {
      try {
        PotokSDK.ui.showEpisodeSelector({
          title: stream.title,
          episodes: mappedEpisodes,
          isSaving: true
        });

        const episodeOffset = epNum - 1;
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

        PotokSDK.ui.showHUD("success", "Смещение успешно сохранено!");
        
        // Re-read overrides and update list
        override = { season: seasonNum, episodeOffset: episodeOffset };
        mappedEpisodes = parseAndMapFiles(override);

        PotokSDK.ui.showEpisodeSelector({
          title: stream.title,
          episodes: mappedEpisodes,
          isSaving: false
        });
      } catch (err) {
        console.error("[TorrentsPlugin] Failed to save override:", err);
        PotokSDK.ui.showHUD("error", "Не удалось сохранить смещение");
        PotokSDK.ui.showEpisodeSelector({
          title: stream.title,
          episodes: mappedEpisodes,
          isSaving: false
        });
      }
    };

    // Update showEpisodeSelector with fully loaded episodes and operational callbacks!
    PotokSDK.ui.showEpisodeSelector({
      title: stream.title,
      episodes: mappedEpisodes,
      seasonsLoading: false,
      onPlay,
      onStartEditing,
      onApplyOverride,
      tmdbSeasonsCount: streamsState.mediaType === "tv" ? 99 : 1
    });

  } catch (err) {
    console.error("[TorrentsPlugin] Failed to fetch/parse torrent files:", err);
    PotokSDK.ui.showHUD("error", "Не удалось прочитать файлы торрента");
    // Close episode selector
    PotokSDK.ui.showEpisodeSelector({
      title: stream.title,
      episodes: [],
      seasonsLoading: false
    });
  }
}

// Render dynamic UI slot mutations
function applyBlockMutations() {
  const filtersBlock = PotokSDK.ui.block("media-streams-filters");
  const resultsBlock = PotokSDK.ui.block("media-streams-results");

  if (streamsState.activeTab === "potok-torrents") {
    filtersBlock.element("streams-filter-bar").hide();
    resultsBlock.element("streams-results-list").hide();

    const resultsLayout = StreamList()
      .streams(streamsState.torrents)
      .loading(streamsState.loading)
      .showFilters(true)
      .emptyText(streamsState.error || "Раздач не найдено. Попробуйте обновить поиск.")
      .nounPlurals(["торрент", "торрента", "торрентов"])
      .onSelectStream(handleSelectStream);

    resultsBlock.append(resultsLayout);
  }

  filtersBlock.apply();
  resultsBlock.apply();
}

// Subscribe streamsState changes to re-trigger layout rendering
streamsState.$subscribe(applyBlockMutations);

// Initial bootstrap rendering
applyBlockMutations();

// --- Sidebar Status Indicator Implementation ---

const statusState = PotokSDK.createState({
  searchEngine: { configured: false, online: false, latency: -1 },
  torrServer: { configured: false, online: false, latency: -1 }
});

function getStatusLabel(info) {
  if (!info.configured) return "выкл";
  if (!info.online || info.latency < 0) return "оффлайн";
  return `${info.latency} ms`;
}

function getStatusBadgeColor(info) {
  if (!info.configured) return "info";
  if (!info.online || info.latency < 0) return "error";
  if (info.latency <= 100) return "success";
  if (info.latency <= 300) return "warning";
  return "error";
}

function buildStatusLayout() {
  return VStack()
    .spacing(8)
    .children([
      HStack()
        .children([
          Badge("").color(getStatusBadgeColor(statusState.searchEngine)),
          Text("Поиск медиа").variant("secondary").size("sm"),
          Text(getStatusLabel(statusState.searchEngine)).variant("hint").size("sm")
        ]),
      HStack()
        .children([
          Badge("").color(getStatusBadgeColor(statusState.torrServer)),
          Text("Торрент-плеер").variant("secondary").size("sm"),
          Text(getStatusLabel(statusState.torrServer)).variant("hint").size("sm")
        ])
    ]);
}

PotokSDK.registerSlotContribution({
  slotName: "sidebar-status",
  id: "torrents-sidebar-status",
  render: () => {
    return {
      label: "Статус Торрентов",
      layout: buildStatusLayout()
    };
  }
});

statusState.$subscribe(() => {
  PotokSDK.ui.render(buildStatusLayout(), "torrents-sidebar-status");
});

async function pingService(baseUrl, path = "/health") {
  if (!baseUrl) return { configured: false, online: false, latency: -1 };
  let url = baseUrl.trim();
  if (!url) return { configured: false, online: false, latency: -1 };
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  if (url.endsWith("/")) {
    url = url.slice(0, -1);
  }
  url = `${url}${path}`;

  const startTime = Date.now();
  try {
    const res = await PotokSDK.http.get(url);
    const latency = Date.now() - startTime;
    if (res.status >= 200 && res.status < 400) {
      return { configured: true, online: true, latency };
    }
    return { configured: true, online: false, latency: -1 };
  } catch (err) {
    return { configured: true, online: false, latency: -1 };
  }
}

async function checkPings() {
  let searchUrl = await PotokSDK.storage.local.getItem("searchEngineURL");
  if (searchUrl === null) searchUrl = PotokSDK.config.searchEngineURL || "";

  let torrUrl = await PotokSDK.storage.local.getItem("torrentGoURL");
  if (torrUrl === null) torrUrl = PotokSDK.config.torrentGoURL || "";

  const [searchRes, torrRes] = await Promise.all([
    pingService(searchUrl, "/health"),
    pingService(torrUrl, "/health")
  ]);

  statusState.searchEngine = searchRes;
  statusState.torrServer = torrRes;
}

// Initial status check & periodic timer setup
checkPings();
setInterval(checkPings, 30000);
