import { providerId, sourceId, sourceQuery } from '../search/searchController.js';
import { episodeLocator } from '../episodes/episodesController.js';
import { createPlaybackPayload } from './playbackMapper.js';
import { providerAccountEnvelope } from '../accounts/accountVault.js';

export function selectAudio(episode, audioId) {
  const audios = episode?.audios || [];
  const audio = audios.find(item => item.id === audioId) || audios[0];
  if (!audio) return episode;
  return {
    ...episode,
    selectedAudioId: audio.id,
    voice: audio.voice || audio.name || episode.voice,
    url: audio.url || episode.url,
    locator: audio.locator || episodeLocator(audio) || episodeLocator(episode),
    provider: audio.provider,
    providerId: audio.providerId,
    sourceId: audio.sourceId,
    quality: audio.quality,
    query: audio.query,
  };
}

export function createPlaybackService({
  client,
  episodeService,
  sessionStore,
  pluginId,
  translate,
  playVideo,
  accountVault = null,
}) {
  async function resolvePlayback(stream, episode, context) {
    let selected = episode || stream;
    if (!episode && selected?.episode == null && stream?.mediaType !== 'movie') {
      const episodeResponse = await episodeService.fetchEpisodes(stream, context);
      if (episodeResponse.episodes[0]) selected = episodeResponse.episodes[0];
    }

    const candidates = selected?.audios?.length ? selected.audios : [selected];
    const selectedCandidateIndex = Math.max(0, candidates.findIndex(candidate =>
      candidate?.id === selected?.selectedAudioId));
    const settled = await Promise.allSettled(candidates.map(async (candidate, candidateIndex) => {
      const target = {
        ...selected,
        ...candidate,
        voice: candidate?.voice || candidate?.name || selected?.voice || stream?.voice || null,
        locator: candidate?.locator || episodeLocator(candidate) || episodeLocator(selected),
      };
      const id = providerId(target) || providerId(stream);
      const account = accountVault ? await accountVault.getAccount(id) : null;
      const response = await client.resolvePlayback({
        provider: id,
        sourceId: sourceId(target) || sourceId(stream),
        query: sourceQuery(target, context),
        season: target?.season ?? context?.season ?? null,
        episode: target?.episode ?? context?.episode ?? null,
        voice: target?.voice || null,
        locator: episodeLocator(target),
        ...(account ? { account: providerAccountEnvelope(id, account) } : {}),
      });
      return { candidateIndex, target, response, providerId: id };
    }));
    const resolved = settled.filter(result => result.status === 'fulfilled').map(result => result.value);
    if (!resolved.length) {
      const failure = settled.find(result => result.status === 'rejected');
      throw failure?.reason || new Error(translate('playback.failed'));
    }

    const primary = resolved.find(item => item.candidateIndex === selectedCandidateIndex) || resolved[0];
    const primaryIndex = resolved.indexOf(primary);
    sessionStore.set(primary.response.session, primary.providerId);
    return createPlaybackPayload({
      client,
      primary,
      primaryIndex,
      resolved,
      stream,
      selected,
      context,
      pluginId,
      translate,
    });
  }

  async function refresh(payload) {
    const stored = sessionStore.get();
    const session = payload?.session || payload?.playbackInfo?.session || stored?.session;
    const sourceProviderId = payload?.onlineProviderId || payload?.playbackInfo?.onlineProviderId
      || stored?.providerId;
    if (!session) throw new Error(translate('playback.missingSession'));
    const account = sourceProviderId && accountVault
      ? await accountVault.getAccount(sourceProviderId)
      : null;
    const response = await client.refreshPlayback(
      session,
      account ? providerAccountEnvelope(sourceProviderId, account) : null,
    );
    sessionStore.set(response.session || session, sourceProviderId);
    return {
      streamUrl: response.streamUrl,
      streamType: response.streamType || 'm3u8',
      voice: response.voice,
    };
  }

  async function play(stream, episode, context) {
    const payload = await resolvePlayback(stream, episode, context);
    if (typeof playVideo !== 'function') throw new Error(translate('playback.failed'));
    playVideo(payload);
    return payload;
  }

  return Object.freeze({ resolvePlayback, play, refresh });
}
