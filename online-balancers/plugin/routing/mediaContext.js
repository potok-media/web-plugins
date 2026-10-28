import { PAGE_PATH } from '../constants.js';

export function numericRouteValue(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function sanitizeTitle(value) {
  const letters = String(value || '').normalize('NFKC').match(/\p{L}+/gu);
  return letters ? letters.join(' ').trim() : '';
}

export function mediaQuery(value = {}) {
  const workId = value.workId || value.arm?.workId || null;
  const entryId = value.entryId || value.arm?.entryId || null;
  const episodeId = value.episodeId || value.arm?.episodeId || null;
  return {
    type: value.type || value.mediaType || null,
    title: value.title || null,
    originalTitle: value.originalTitle || value.englishTitle || null,
    imdbId: value.imdbId || null,
    year: numericRouteValue(value.year),
    tmdbId: numericRouteValue(value.tmdbId),
    kinopoiskId: numericRouteValue(value.kinopoiskId),
    ...(workId ? { workId } : {}),
    ...(entryId ? { entryId } : {}),
    ...(episodeId ? { episodeId } : {}),
  };
}

export function pageContextFromRoute(query = {}) {
  return mediaQuery({
    type: query.type || null,
    title: sanitizeTitle(query.q),
    originalTitle: sanitizeTitle(query.originalTitle),
    imdbId: query.imdbId || null,
    year: numericRouteValue(query.year),
    tmdbId: numericRouteValue(query.tmdbId),
    kinopoiskId: numericRouteValue(query.kinopoiskId),
    workId: query.workId || null,
    entryId: query.entryId || null,
    episodeId: query.episodeId || null,
  });
}

export function pageUrl(query, context = {}) {
  const params = new URLSearchParams();
  params.set('q', sanitizeTitle(query));
  if (context.type) params.set('type', context.type);
  if (context.originalTitle) params.set('originalTitle', sanitizeTitle(context.originalTitle));
  if (context.imdbId) params.set('imdbId', context.imdbId);
  if (context.year) params.set('year', String(context.year));
  if (context.tmdbId) params.set('tmdbId', String(context.tmdbId));
  if (context.kinopoiskId) params.set('kinopoiskId', String(context.kinopoiskId));
  if (context.workId) params.set('workId', context.workId);
  if (context.entryId) params.set('entryId', context.entryId);
  if (context.episodeId) params.set('episodeId', context.episodeId);
  return `${PAGE_PATH}?${params.toString()}`;
}
