import { isPlayableUrl } from '../search/searchController.js';

export function withAudioIndex(url, index) {
  if (!url) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}audio=${index}`;
}

export function resolvedAudioUrl(client, response, index) {
  return withAudioIndex(response?.streamUrl, index);
}

export function createPlaybackPayload({
  client,
  primary,
  primaryIndex,
  resolved,
  candidates,
  stream,
  selected,
  context,
  pluginId,
  translate,
  episodes,
  activeEpisodeId,
  resolvedUrlMap,
}) {
  const safeStr = (v) => v != null ? JSON.parse(JSON.stringify(v)) : undefined;
  console.log('[PlaybackMapper] createPlaybackPayload ENTER', {
    primaryStreamUrl: primary?.response?.streamUrl,
    selected: safeStr(selected),
    context: safeStr(context),
    stream: safeStr(stream),
    playlistLength: (episodes || []).length,
    activeEpisodeId,
    resolvedUrlMapSize: resolvedUrlMap?.size ?? 0,
  });
  const season = selected?.season ?? context?.season;
  const episodeNumber = selected?.episode ?? context?.episode;
  const title = context?.title || stream?.sourceTitle || stream?.title
    || translate('playback.fallbackMediaTitle');
  const urlMap = resolvedUrlMap ?? new Map();
  const playlist = (episodes || []).map((ep) => {
    const resolved = urlMap.get(ep.id);
    const epAudios = ep?.audios || [];
    return {
      id: ep.id,
      season: ep.season,
      episode: ep.episode,
      title: ep.title,
      workId: ep.workId,
      episodeId: ep.episodeId,
      entryId: ep.entryId,
      episodeIds: ep.episodeIds,
      targets: ep.targets,
      streamUrl: resolved?.streamUrl ?? ep?.streamUrl ?? ep?.url,
      headers: resolved?.headers ?? ep?.headers,
      // Voice variants travel with the item so host-side playlist navigation and voice switching
      // can rebuild the full candidate list. Candidates KEEP their provider identity — a merged
      // list may span providers (e.g. "AniDUB · Kodik" next to "AniLiberty"), and switching to one
      // re-resolves through ITS provider. `name` is the FULL "Voice · Quality · Provider" label:
      // the balancer identity in it is useful info and one canonical naming everywhere keeps
      // voice matching and session memory consistent across open paths. The `?audio=N` url
      // convention is dead (CDNs ignore it), so entries carry their own resolved url or '' —
      // switching always re-resolves by voice.
      audios: epAudios.map((audio) => ({
        name: audio?.name || audio?.voice || undefined,
        label: audio?.name || null,
        voice: audio?.voice || null,
        providerId: audio?.providerId || null,
        sourceId: audio?.sourceId || null,
        query: audio?.query || null,
        url: isPlayableUrl(audio?.url) ? audio.url : '',
      })),
      voice: epAudios[0]?.voice || epAudios[0]?.name || undefined,
    };
  });
  const playlistIndex = playlist.length > 0
    ? playlist.findIndex((item) => String(item.id) === String(activeEpisodeId))
    : 0;
  // The streamUrl is used verbatim: the backend bakes the voice into it (libria even carries its
  // own native `audio` param). Appending the plugin's `?audio=N` convention here used to create a
  // duplicate/conflicting param — CDNs ignore it anyway (proven: segments keep `-a1` names).
  const payload = {
    streamUrl: primary.response.streamUrl,
    streamType: primary.response.streamType || 'm3u8',
    headers: primary.response.headers ?? undefined,
    title: season && episodeNumber ? `${title} — S${season}E${episodeNumber}` : title,
    mediaType: context?.type || stream?.mediaType,
    id: Number(context?.tmdbId) || 0,
    season,
    episode: episodeNumber,
    workId: selected?.workId || context?.workId || null,
    entryId: selected?.entryId || context?.entryId || null,
    episodeId: selected?.episodeId || context?.episodeId || null,
    // One entry per voice candidate. `name` is the FULL "Voice · Quality · Provider" label — the
    // canonical display name everywhere (menu, switch requests, session memory); the balancer
    // identity in it is information, not noise. `voice` keeps the plain label for matching.
    // Candidates keep provider identity — a merged list can span providers, and switching
    // re-resolves through the candidate's OWN provider. urls are the candidate's own resolved link
    // or '': the `?audio=N` fabrication pointed every entry at the primary provider's stream
    // (e.g. Kodik dubs "served" from a libria URL).
    audios: candidates?.length
      ? candidates.map((candidate, index) => ({
          name: candidate?.name || candidate?.voice
            || resolved.find(item => item.candidateIndex === index)?.target?.voice
            || selected?.voice || stream?.voice || primary.response.voice
            || translate('playback.voiceNumber', { number: index + 1 }),
          label: candidate?.name || null,
          voice: candidate?.voice || null,
          providerId: candidate?.providerId || null,
          sourceId: candidate?.sourceId || null,
          query: candidate?.query || null,
          url: isPlayableUrl(candidate?.url) ? candidate.url : '',
        }))
      : resolved.map((item, index) => ({
          name: item.target.voice || item.response.voice
            || translate('playback.voiceNumber', { number: index + 1 }),
          url: resolvedAudioUrl(client, item.response, index),
        })),
    providerId: pluginId,
    onlineProviderId: primary.providerId,
    voice: primary.target.voice || primary.response.voice || stream?.voice
      || translate('playback.fallbackVoice'),
    playlist,
    playlistIndex,
    sourceStream: {
      id: stream.id,
      title: stream.title,
      originalTitle: stream.originalTitle,
      mediaType: stream.mediaType,
      providerId: primary.providerId,
      sourceId: primary.target?.sourceId,
      // The host replays these fields when resolving the next playlist episode —
      // without query a next-episode request degrades to provider+sourceId only.
      query: stream.query ?? null,
      voice: primary.target?.voice || stream?.voice || null,
    },
  };
  console.log('[PlaybackMapper] createPlaybackPayload RETURN', {
    streamUrl: payload.streamUrl,
    streamType: payload.streamType,
    title: payload.title,
    season: payload.season,
    episode: payload.episode,
    playlistLength: payload.playlist?.length,
    playlistIndex: payload.playlistIndex,
    hasSourceStream: !!payload.sourceStream,
    sourceStream: payload.sourceStream,
    providerId: payload.providerId,
    onlineProviderId: payload.onlineProviderId,
    voice: payload.voice,
    audios: payload.audios?.map(a => ({ name: a.name, url: a.url })),
  });
  return payload;
}
