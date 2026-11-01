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
      audios: [],
    };
  });
  const playlistIndex = playlist.length > 0
    ? playlist.findIndex((item) => String(item.id) === String(activeEpisodeId))
    : 0;
  const payload = {
    streamUrl: withAudioIndex(primary.response.streamUrl, primaryIndex),
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
    audios: resolved.map((item, index) => ({
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
