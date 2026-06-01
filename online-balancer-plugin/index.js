import { PotokSDK } from 'potok-sdk';
import { VideoDBProvider } from './providers/videodb.js';
import { LiftProvider } from './providers/lift.js';
import { KinotochkaProvider } from './providers/kinotochka.js';
import { fetchOnlineEpisodes } from './utils/episodes.js';

// Initialize search providers
const videoDB = new VideoDBProvider();
const lift = new LiftProvider();
const kinotochka = new KinotochkaProvider();

const providers = {
  [videoDB.id]: videoDB,
  [lift.id]: lift,
  [kinotochka.id]: kinotochka
};

function mapSearchResult(s, includeId = false) {
  const providerInstance = providers[s.provider];
  const providerName = providerInstance ? providerInstance.name : s.provider;
  const displayQuality = ["1080p", "2160p", "4K"].includes(s.quality) 
    ? (s.quality === "1080p" ? "1080p" : "2160p") 
    : (s.quality === "720p" ? "720p" : "480p");
  const displayKind = s.kind || (s.url?.includes(".m3u8") ? "hls" : s.url?.includes(".mpd") ? "dash" : "mp4");

  const result = {
    title: providerName,
    quality: displayQuality,
    url: s.url,
    streamUrl: s.url,
    provider: providerName,
    providerId: s.provider,
    voice: s.voice || "",
    kind: displayKind === "hls" ? "m3u8" : displayKind,
    headers: s.headers,
    audios: s.audios
  };
  if (includeId) {
    result.id = `${s.provider}:${s.id || Math.random()}`;
  }
  return result;
}

function withTimeout(promise, ms, name) {
  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(`[OnlineBalancer] ${name} search timed out after ${ms}ms`);
      resolve([]);
    }, ms);
  });
  return Promise.race([
    promise.then((val) => {
      clearTimeout(timeoutId);
      return val;
    }),
    timeoutPromise
  ]);
}

PotokSDK.streams.registerStreamSource({
  id: "potok-online-balancer",
  name: "Модульные Онлайн Источники",
  supportedTypes: ["movie", "tv"],

  async search(query) {
    const providerQuery = {
      type: query.type,
      tmdbId: query.tmdbId,
      season: query.season,
      episode: query.episode
    };
    const results = await Promise.all([
      withTimeout(videoDB.search(providerQuery).catch(err => { console.error(err); return []; }), 4000, "VideoDB"),
      withTimeout(lift.search(providerQuery).catch(err => { console.error(err); return []; }), 4000, "Lift"),
      withTimeout(kinotochka.search(providerQuery).catch(err => { console.error(err); return []; }), 4000, "Kinotochka")
    ]);
    return results.flat().map(s => mapSearchResult(s, true));
  },

  async getEpisodes(stream, context) {
    const refinedFiles = await fetchOnlineEpisodes(stream.providerId, { id: context.tmdbId });
    const maxSeason = refinedFiles.length > 0 ? Math.max(...refinedFiles.map(f => f.season), 1) : 1;
    return {
      episodes: refinedFiles.map(f => ({
        id: `${f.season}:${f.episode}`,
        season: f.season,
        episode: f.episode,
        title: f.title || `Серия ${f.episode}`,
        stillPath: f.stillPath,
        airDate: f.airDate,
        url: f.url,
        audios: f.audios,
        headers: f.headers
      })),
      tmdbSeasonsCount: maxSeason
    };
  },

  async getPlaybackInfo(stream, episode, context) {
    if (context.type === "tv") {
      const defaultAudio = episode.audios && episode.audios.length > 0 ? episode.audios[0] : null;
      const finalUrl = defaultAudio ? defaultAudio.url : episode.url;

      const showTitle = context.title || stream.title || "Сериал";
      const seasonNum = episode.season !== undefined ? episode.season : 1;
      const episodeNum = episode.episode !== undefined ? episode.episode : 1;
      const episodeTitle = episode.title || `Серия ${episodeNum}`;
      const cleanEpisodeTitle = episodeTitle.replace(/^\d+[\s.\-_]+/, "").trim();

      return {
        streamUrl: finalUrl,
        streamType: finalUrl.includes(".m3u8") ? "m3u8" : finalUrl.includes(".mpd") ? "dash" : "mp4",
        title: `${showTitle} - S${seasonNum}E${episodeNum} - ${cleanEpisodeTitle}`,
        season: seasonNum,
        episode: episodeNum,
        audios: episode.audios,
        headers: episode.headers,
        providerId: stream.providerId,
        voice: defaultAudio ? defaultAudio.name : "Основной поток"
      };
    }
    const finalUrl = stream.url || stream.streamUrl || "";
    return {
      streamUrl: finalUrl,
      streamType: finalUrl.includes(".m3u8") ? "m3u8" : finalUrl.includes(".mpd") ? "dash" : "mp4",
      title: context.title || stream.title || "Видео",
      audios: stream.audios,
      headers: stream.headers,
      providerId: stream.providerId,
      voice: stream.voice || "Основной поток"
    };
  },

  async refreshStreamUrl(payload) {
    const { providerId, mediaId, mediaType, season, episode, voice } = payload;
    if (mediaType === "tv") {
      const refinedFiles = await fetchOnlineEpisodes(providerId, { id: mediaId });
      if (!refinedFiles || refinedFiles.length === 0) {
        throw new Error('No episodes resolved from balancer');
      }
      const file = refinedFiles.find(f => f.season === season && f.episode === episode);
      if (!file) {
        throw new Error(`Episode S${season}E${episode} not found in balancer`);
      }
      let finalUrl = file.url;
      if (voice && file.audios && file.audios.length > 0) {
        const matchedAudio = file.audios.find(a => a.name === voice);
        if (matchedAudio) finalUrl = matchedAudio.url;
      }
      return {
        streamUrl: finalUrl,
        audios: file.audios,
        headers: file.headers
      };
    }
    const query = { type: "movie", tmdbId: mediaId };
    const providerInstance = providers[providerId];
    if (!providerInstance) throw new Error(`Provider ${providerId} not found`);
    const searchResults = await providerInstance.search(query);
    if (!searchResults || searchResults.length === 0) {
      throw new Error('No search results found');
    }
    const matched = searchResults[0];
    return {
      streamUrl: matched.url,
      audios: matched.audios,
      headers: matched.headers
    };
  }
});

// Register slot contribution for "Смотреть Онлайн" button
PotokSDK.registerSlotContribution({
  id: "online-balancer-media-actions",
  slotName: "media-actions",
  render(props) {
    return {
      label: "Смотреть Онлайн",
      layout: PotokSDK.ui.components.Button("Смотреть Онлайн")
        .variant("watch-online")
        .onClick(() => {
          PotokSDK.ui.navigateTo(`/media/${props.mediaType}/${props.mediaId}/watch/potok-online-balancer`);
        })
    };
  }
});
