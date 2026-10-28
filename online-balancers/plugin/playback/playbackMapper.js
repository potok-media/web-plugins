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
}) {
  const season = selected?.season ?? context?.season;
  const episodeNumber = selected?.episode ?? context?.episode;
  const title = context?.title || stream?.sourceTitle || stream?.title
    || translate('playback.fallbackMediaTitle');
  return {
    streamUrl: withAudioIndex(primary.response.streamUrl, primaryIndex),
    streamType: primary.response.streamType,
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
    voice: primary.response.voice || primary.target.voice || stream?.voice
      || translate('playback.fallbackVoice'),
  };
}
