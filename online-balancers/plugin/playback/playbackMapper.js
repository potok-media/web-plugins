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
  candidateUrls,
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
  const title = context?.title || stream?.sourceTitle || stream?.title
    || translate('playback.fallbackMediaTitle');
  const urlMap = resolvedUrlMap ?? new Map();

  // The full cross-provider candidate list belongs to the ACTIVE episode's item (R2): the host's
  // voice menu reads only playlist[playlistIndex].audios and switches by a local url swap — never
  // by re-resolving. Candidates KEEP their provider identity — a merged list may span providers.
  // `name` is the FULL "Voice · Quality · Provider" label: the balancer identity in it is useful
  // info and one canonical naming everywhere keeps voice matching and session memory consistent
  // across open paths.
  const activeAudios = candidates?.length
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
        url: isPlayableUrl(candidate?.url) ? candidate.url : candidateUrls?.get(index)?.url ?? '',
      }))
    : resolved.map((item, index) => ({
        name: item.target.voice || item.response.voice
          || translate('playback.voiceNumber', { number: index + 1 }),
        url: resolvedAudioUrl(client, item.response, index),
      }));

  const playlist = (episodes || []).map((ep) => {
    const resolved = urlMap.get(ep.id);
    const epAudios = ep?.audios || [];
    const resolvedAudios = resolved?.audios ?? null;
    const isActive = String(ep.id) === String(activeEpisodeId);
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
      filler: ep.filler ?? null,
      // R3: every item carries its OWN ready content — the host plays items verbatim and never
      // resolves. The streamUrl is used verbatim: the backend bakes the voice into it (libria even
      // carries its own native `audio` param). Appending the plugin's `?audio=N` convention here
      // used to create a duplicate/conflicting param — CDNs ignore it anyway (proven: segments
      // keep `-a1` names).
      streamUrl: resolved?.streamUrl ?? ep?.streamUrl ?? ep?.url,
      streamType: resolved?.streamType ?? ep?.streamType ?? 'm3u8',
      headers: resolved?.headers ?? ep?.headers,
      // Voice variants travel with ready urls — the player switches voices by a local swap.
      // The ACTIVE item gets the full cross-provider candidate menu; other items keep their own
      // per-episode lists.
      audios: isActive
        ? activeAudios
        : epAudios.map((audio, audioIndex) => ({
            name: audio?.name || audio?.voice || undefined,
            label: audio?.name || null,
            voice: audio?.voice || null,
            providerId: audio?.providerId || null,
            sourceId: audio?.sourceId || null,
            query: audio?.query || null,
            url: isPlayableUrl(audio?.url) ? audio.url : resolvedAudios?.[audioIndex]?.url ?? '',
          })),
      voice: epAudios[0]?.voice || epAudios[0]?.name || undefined,
    };
  });
  const playlistIndex = playlist.length > 0
    ? playlist.findIndex((item) => String(item.id) === String(activeEpisodeId))
    : 0;

  // Single-file / movie flow: no episode list at all → the playlist is exactly ONE item built
  // from the primary response (R3: a movie is a one-item playlist).
  if (playlist.length === 0) {
    playlist.push({
      id: selected?.id,
      season: selected?.season ?? context?.season,
      episode: selected?.episode ?? context?.episode,
      title: selected?.title,
      workId: selected?.workId || context?.workId || null,
      episodeId: selected?.episodeId || context?.episodeId || null,
      entryId: selected?.entryId || context?.entryId || null,
      streamUrl: primary.response.streamUrl,
      streamType: primary.response.streamType || 'm3u8',
      headers: primary.response.headers ?? undefined,
      audios: activeAudios,
      voice: primary.target.voice || primary.response.voice || undefined,
    });
  }
  const resolvedPlaylistIndex = playlistIndex !== -1 ? playlistIndex : 0;

  // R3: NO top-level streamUrl/streamType/headers/audios — playlist[] is the only content carrier.
  const payload = {
    title,
    mediaType: context?.type || stream?.mediaType,
    id: Number(context?.tmdbId) || 0,
    workId: selected?.workId || context?.workId || null,
    entryId: selected?.entryId || context?.entryId || null,
    episodeId: selected?.episodeId || context?.episodeId || null,
    providerId: pluginId,
    onlineProviderId: primary.providerId,
    voice: primary.target.voice || primary.response.voice || stream?.voice
      || translate('playback.fallbackVoice'),
    playlist,
    playlistIndex: resolvedPlaylistIndex,
    sourceStream: {
      id: stream.id,
      title: stream.title,
      originalTitle: stream.originalTitle,
      mediaType: stream.mediaType,
      providerId: primary.providerId,
      sourceId: primary.target?.sourceId,
      // The host echoes these back when re-windowing the release.
      query: stream.query ?? null,
      voice: primary.target?.voice || stream?.voice || null,
    },
  };
  console.log('[PlaybackMapper] createPlaybackPayload RETURN', {
    title: payload.title,
    playlistLength: payload.playlist?.length,
    playlistIndex: payload.playlistIndex,
    hasSourceStream: !!payload.sourceStream,
    sourceStream: payload.sourceStream,
    providerId: payload.providerId,
    onlineProviderId: payload.onlineProviderId,
    voice: payload.voice,
  });
  return payload;
}
