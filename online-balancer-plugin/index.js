import { PotokSDK } from 'potok-sdk';
import { VideoDBProvider } from './providers/videodb.js';
import { LiftProvider } from './providers/lift.js';
import { KinotochkaProvider } from './providers/kinotochka.js';
import { fetchOnlineEpisodes } from './utils/episodes.js';

// Initialize search providers for online balancers
const videoDB = new VideoDBProvider();
const lift = new LiftProvider();
const kinotochka = new KinotochkaProvider();

// Dynamic providers registry to resolve names without hardcoding
const providers = {
  [videoDB.id]: videoDB,
  [lift.id]: lift,
  [kinotochka.id]: kinotochka
};

// Helper to map raw search results into standardized stream schema
function mapSearchResult(s, includeId = false) {
  const providerInstance = providers[s.provider];
  const providerName = providerInstance ? providerInstance.name : s.provider;
  const voiceLabel = s.voice || "";
  
  const displayTitle = providerName;
  const displayQuality = ["1080p", "2160p", "4K"].includes(s.quality) ? (s.quality === "1080p" ? "1080p" : "2160p") : s.quality === "720p" ? "720p" : "480p";
  const displayKind = s.kind || (s.url?.includes(".m3u8") ? "hls" : s.url?.includes(".mpd") ? "dash" : "mp4");

  const result = {
    title: displayTitle,
    quality: displayQuality,
    url: s.url,
    streamUrl: s.url,
    provider: providerName,
    providerId: s.provider,
    voice: voiceLabel,
    kind: displayKind === "hls" ? "m3u8" : displayKind,
    headers: s.headers
  };

  if (includeId) {
    result.id = `${s.provider}:${s.id || Math.random()}`;
  }

  return result;
}

const { HStack, Button, StreamList } = PotokSDK.ui.components;

// Register slot contribution for the Details Page watch button
PotokSDK.registerSlotContribution({
  slotName: "media-actions",
  id: "online-balancer-media-actions",
  render: (props) => {
    const url = `/media/${props.mediaType}/${props.mediaId}/watch/potok-online-balancer` + 
      (props.season ? `?season=${props.season}&episode=${props.episode}` : "");

    return {
      label: "Смотреть Онлайн",
      layout: Button("Смотреть Онлайн")
        .variant("watch-online")
        .onClick(() => {
          PotokSDK.ui.navigateTo(url);
        })
    };
  }
});

// Register headless search provider in the host for search query delegation
PotokSDK.media.searchProvider("potok-online-balancer", "Модульные Онлайн Источники")
  .onSearch(async (query) => {
    const results = await Promise.all([
      videoDB.search(query).catch(err => { console.error(err); return []; }),
      lift.search(query).catch(err => { console.error(err); return []; }),
      kinotochka.search(query).catch(err => { console.error(err); return []; })
    ]);

    return results.flat().map(s => mapSearchResult(s, true));
  });

// Reactive state for the Streams Page Slot Sandbox
const streamsState = PotokSDK.createState({
  activeTab: "default", // "default" | "online"
  mediaId: null,
  mediaType: null,
  season: null,
  episode: null,
  title: "",
  streams: [],
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

    // Dynamic routing synchronization on query parameters
    if (context.tab) {
      streamsState.activeTab = context.tab;
    } else {
      streamsState.activeTab = "potok-online-balancer";
    }

    if (isNewContext && streamsState.activeTab === "potok-online-balancer") {
      runOnlineSearch();
    }
  }
});

// Fetch search results from online providers dynamically
async function runOnlineSearch() {
  if (!streamsState.mediaId) return;
  streamsState.loading = true;
  streamsState.streams = [];
  streamsState.error = "";

  const query = {
    type: streamsState.mediaType === "tv" ? "tv" : "movie",
    tmdbId: streamsState.mediaId,
    season: streamsState.season,
    episode: streamsState.episode
  };

  try {
    const results = await Promise.all([
      videoDB.search(query).catch(err => { console.error(err); return []; }),
      lift.search(query).catch(err => { console.error(err); return []; }),
      kinotochka.search(query).catch(err => { console.error(err); return []; })
    ]);

    streamsState.streams = results.flat().map(s => mapSearchResult(s, false));
  } catch (err) {
    streamsState.error = "Ошибка при поиске онлайн-источников.";
  } finally {
    streamsState.loading = false;
  }
}

// Handle playing/episode choosing on stream selection
async function handleSelectStream(stream) {
  if (streamsState.mediaType === "tv") {
    PotokSDK.ui.showHUD("info", "Загрузка серий с балансера...");
    try {
      const refinedFiles = await fetchOnlineEpisodes(stream.providerId, { id: streamsState.mediaId });
      
      if (!refinedFiles || refinedFiles.length === 0) {
        PotokSDK.ui.showHUD("error", "Не удалось найти серии для этого источника.");
        return;
      }

      PotokSDK.ui.showEpisodeSelector({
        title: `Серии онлайн: ${stream.provider}`,
        episodes: refinedFiles,
        tmdbSeasonsCount: Math.max(...refinedFiles.map(f => f.season), 1),
        onPlay: (episode) => {
          const file = refinedFiles.find(f => f.season === episode.season && f.episode === episode.episode);
          if (file) {
            const defaultAudio = file.audios && file.audios.length > 0 ? file.audios[0] : null;
            const finalUrl = defaultAudio ? defaultAudio.url : file.url;
            const finalVoiceName = defaultAudio ? defaultAudio.name : "Основной поток";

            PotokSDK.ui.playVideo({
              streamUrl: finalUrl,
              streamType: finalUrl.includes(".m3u8") ? "m3u8" : finalUrl.includes(".mpd") ? "dash" : "mp4",
              title: `${file.title || "Серия"} - S${file.season}E${file.episode}`,
              mediaType: "tv",
              id: streamsState.mediaId,
              season: file.season,
              episode: file.episode,
              audios: file.audios,
              headers: file.headers,
              providerId: stream.providerId,
              voice: finalVoiceName
            });
          }
        }
      });
    } catch (err) {
      PotokSDK.ui.showHUD("error", "Не удалось получить список серий.");
    }
  } else {
    PotokSDK.ui.playVideo({
      streamUrl: stream.streamUrl,
      streamType: stream.kind === "mp4" ? "mp4" : "m3u8",
      title: streamsState.title || "Видео",
      mediaType: "movie",
      id: streamsState.mediaId,
      audios: stream.audios,
      headers: stream.headers,
      providerId: stream.providerId,
      voice: stream.voice
    });
  }
}

// Render dynamic UI slot mutations
function applyBlockMutations() {
  const filtersBlock = PotokSDK.ui.block("media-streams-filters");
  const resultsBlock = PotokSDK.ui.block("media-streams-results");

  // Manage UI mutations based on the active tab
  if (streamsState.activeTab === "potok-online-balancer") {
    filtersBlock.element("streams-filter-bar").hide();
    resultsBlock.element("streams-results-list").hide();

    const resultsLayout = StreamList()
      .streams(streamsState.streams)
      .loading(streamsState.loading)
      .showFilters(true)
      .emptyText(streamsState.error || "Источники не найдены. Попробуйте обновить поиск.")
      .nounPlurals(["источник", "источника", "источников"])
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

// Listen to stream refresh events from the host
window.addEventListener('message', async (e) => {
  const msg = e.data;
  if (!msg || msg.source !== 'potok-host') return;

  if (msg.action === 'REFRESH_STREAM_URL') {
    const { providerId, mediaId, mediaType, season, episode, voice } = msg.payload;
    try {
      console.log(`[Plugin] Refreshing stream url for ${providerId}, media ${mediaId}, ${mediaType} S${season}E${episode}`);
      if (mediaType === "tv") {
        const refinedFiles = await fetchOnlineEpisodes(providerId, { id: mediaId });
        if (refinedFiles && refinedFiles.length > 0) {
          const file = refinedFiles.find(f => f.season === season && f.episode === episode);
          if (file) {
            let finalUrl = file.url;

            // Try to match the translation/voice if voice name is specified
            if (voice && file.audios && file.audios.length > 0) {
              const matchedAudio = file.audios.find(a => a.name === voice);
              if (matchedAudio) {
                finalUrl = matchedAudio.url;
              }
            }

            window.parent.postMessage({
              source: 'potok-plugin-sdk',
              action: 'REFRESH_STREAM_URL_RESPONSE',
              payload: {
                success: true,
                streamUrl: finalUrl,
                audios: file.audios,
                headers: file.headers
              }
            }, '*');
          } else {
            throw new Error(`Episode S${season}E${episode} not found in balancer`);
          }
        } else {
          throw new Error('No episodes resolved from balancer');
        }
      } else {
        // For movies, we just run a search query
        const query = {
          type: "movie",
          tmdbId: mediaId
        };
        const providerInstance = providers[providerId];
        if (!providerInstance) throw new Error(`Provider ${providerId} not found`);
        const searchResults = await providerInstance.search(query);
        if (searchResults && searchResults.length > 0) {
          const matched = searchResults[0];
          window.parent.postMessage({
            source: 'potok-plugin-sdk',
            action: 'REFRESH_STREAM_URL_RESPONSE',
            payload: {
              success: true,
              streamUrl: matched.url,
              audios: matched.audios,
              headers: matched.headers
            }
          }, '*');
        } else {
          throw new Error('No search results found');
        }
      }
    } catch (err) {
      console.error("[Plugin] Failed to refresh stream:", err);
      window.parent.postMessage({
        source: 'potok-plugin-sdk',
        action: 'REFRESH_STREAM_URL_RESPONSE',
        payload: {
          success: false,
          error: err.message || "Failed to resolve stream URL"
        }
      }, '*');
    }
  }
});
