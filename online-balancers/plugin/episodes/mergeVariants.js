import { providerId, sourceId } from '../search/searchController.js';
import { variantVoice } from '../search/grouping.js';

export function audioCandidate(stream, episode, audio, index) {
  const voice = variantVoice(stream, audio?.name || episode?.voice);
  const quality = audio?.quality || episode?.quality || stream.quality;
  const provider = audio?.provider || episode?.provider || stream.provider;
  return {
    id: `${stream.id}:${episode?.season ?? 'movie'}:${episode?.episode ?? 0}:${audio?.id || `default-${index}`}`,
    name: [voice, quality, provider].filter(Boolean).join(' · '),
    // Never fall back to stream.url here: it is the plugin-internal
    // `online-balancers://` handle, not a playable link. Unresolved URLs stay
    // empty — the play path resolves the selected episode on demand.
    url: audio?.url || episode?.url || '',
    locator: audio?.locator || episode?.locator || null,
    voice,
    quality,
    provider,
    providerId: audio?.providerId || episode?.providerId || providerId(stream),
    sourceId: audio?.sourceId || episode?.sourceId || sourceId(stream),
    query: audio?.query || episode?.query || stream.query,
  };
}

export function mergeEpisodeVariants(results) {
  const episodes = new Map();
  for (const { stream, result } of results) {
    for (const episode of result.episodes) {
      const key = `${episode.season ?? 1}:${episode.episode ?? episode.id}`;
      let merged = episodes.get(key);
      if (!merged) {
        merged = {
          id: key,
          season: episode.season ?? 1,
          episode: episode.episode,
          title: episode.title,
          url: episode.url,
          locator: episode.locator,
          workId: episode.workId || undefined,
          entryId: episode.entryId || undefined,
          episodeId: episode.episodeId || undefined,
          rawSeason: episode.rawSeason ?? episode.season,
          rawEpisode: episode.rawEpisode ?? episode.episode,
          groupTitle: episode.groupTitle || null,
          groupDisplayNumber: episode.groupDisplayNumber ?? (episode.entryId ? episode.season : undefined),
          groupKind: episode.groupKind || null,
          displayOrdinal: episode.displayOrdinal ?? (episode.entryId ? episode.episode : undefined),
          resolutionState: episode.resolutionState || undefined,
          confidence: episode.confidence ?? null,
          bindingMethod: episode.bindingMethod || null,
          rawEvidence: episode.rawEvidence || null,
          overview: episode.overview || null,
          stillPath: episode.stillPath || null,
          airDate: episode.airDate || null,
          filler: episode.filler || null,
          tmdb: episode.tmdb || null,
          voice: '',
          provider: episode.provider || stream.provider,
          providerId: episode.providerId || providerId(stream),
          sourceId: episode.sourceId || sourceId(stream),
          quality: episode.quality || stream.quality,
          query: episode.query || stream.query,
          audios: [],
        };
        episodes.set(key, merged);
      }

      const variants = episode.audios?.length ? episode.audios : [null];
      for (let index = 0; index < variants.length; index += 1) {
        const candidate = audioCandidate(stream, episode, variants[index], index);
        const duplicate = merged.audios.some(item =>
          item.providerId === candidate.providerId
          && item.sourceId === candidate.sourceId
          && item.voice === candidate.voice
          && item.url === candidate.url);
        if (!duplicate) merged.audios.push(candidate);
      }
      merged.url ||= merged.audios[0]?.url;
      merged.locator ||= merged.audios[0]?.locator;
    }
  }

  return [...episodes.values()].sort((left, right) =>
    (left.season || 0) - (right.season || 0)
    || (left.episode || 0) - (right.episode || 0));
}

export function movieEpisode(group) {
  const audios = group.variants.map((stream, index) => audioCandidate(stream, null, null, index));
  return {
    id: `${group.id}:movie`,
    season: 1,
    episode: 1,
    title: group.title,
    workId: group.workId || null,
    entryId: group.entryId || null,
    groupTitle: group.title,
    groupDisplayNumber: group.armNumber ?? 1,
    groupKind: group.armKind || 'movie',
    resolutionState: group.entryId ? 'resolved' : null,
    url: audios[0]?.url,
    locator: audios[0]?.locator,
    voice: '',
    audios,
  };
}
