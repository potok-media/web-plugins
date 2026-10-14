const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canonicalId(value) {
  return typeof value === 'string' && UUID.test(value) && value !== '00000000-0000-0000-0000-000000000000'
    ? value.toLowerCase() : undefined;
}

export function titleKey(workId) { return canonicalId(workId); }

export function normalizeCursor(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const stream = raw.stream || raw.Stream || {};
  const workId = canonicalId(raw.workId ?? raw.WorkId ?? stream.workId);
  if (!workId) return null;
  let updatedAt = raw.updatedAt ?? raw.UpdatedAt;
  if (typeof updatedAt === 'string') updatedAt = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAt)) updatedAt = Date.now();
  const hash = (raw.infoHash || raw.InfoHash || stream.hash || '').toLowerCase();
  return {
    workId,
    episodeId: canonicalId(raw.episodeId ?? raw.EpisodeId ?? stream.episodeId),
    entryId: canonicalId(raw.entryId ?? raw.EntryId ?? stream.entryId),
    mediaType: (raw.mediaType || raw.MediaType) === 'movie' ? 'movie' : 'tv',
    title: raw.title || raw.Title || stream.title || '',
    posterSrc: raw.posterSrc || raw.PosterSrc,
    backdropSrc: raw.backdropSrc || raw.BackdropSrc,
    stillSrc: raw.stillSrc || raw.StillSrc,
    stream: { ...stream, workId, title: stream.title || raw.title || raw.Title || '', hash: hash || stream.hash },
    fileIndex: String(raw.fileIndex ?? raw.FileIndex ?? ''),
    season: raw.season ?? raw.Season,
    episode: raw.episode ?? raw.Episode,
    progressSeconds: Number(raw.progressSeconds ?? raw.ProgressSeconds) || 0,
    durationSeconds: Number(raw.durationSeconds ?? raw.DurationSeconds) || 0,
    audioName: raw.audioName || raw.AudioName,
    updatedAt,
  };
}

export function toApiBody(cursor) {
  return {
    mediaType: cursor.mediaType, workId: cursor.workId,
    episodeId: cursor.episodeId, entryId: cursor.entryId,
    title: cursor.title, fileIndex: cursor.fileIndex,
    progressSeconds: cursor.progressSeconds, durationSeconds: cursor.durationSeconds,
    posterSrc: cursor.posterSrc, backdropSrc: cursor.backdropSrc, stillSrc: cursor.stillSrc,
    season: cursor.season, episode: cursor.episode, audioName: cursor.audioName,
    infoHash: cursor.stream?.hash, stream: cursor.stream,
  };
}
