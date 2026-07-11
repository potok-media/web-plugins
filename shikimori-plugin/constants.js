export const PAGE_ID = 'potok-shikimori';
export const PAGE_PATH = `/extensions/${PAGE_ID}`;
export const HOME_ID = 'potok-shikimori-home';

/** Shikimori GraphQL page size for catalog infinite scroll (one request per page). */
export const CATALOG_LIMIT = 100;

export const ORDER_VALUES = ['popularity', 'ranked', 'aired_on'];
export const STATUS_VALUES = ['anons', 'ongoing', 'released'];
export const KIND_VALUES = ['tv', 'movie', 'ova', 'ona', 'special'];

export const RESOLVE_HUD_MS = 3000;

export const SHELF_TTL = 1 * 24 * 60 * 60 * 1000;
export const GENRES_TTL = 7 * 24 * 60 * 60 * 1000;
export const SHELF_REQUEST_DELAY = 250;

/** Landing shelves — one fetchAnimes each; `see` = catalog filter for "see all". */
export const SHELVES = [
  { id: 'popular', key: 'rows.popular', filters: { order: 'popularity' }, see: { order: 'popularity' } },
  { id: 'top', key: 'rows.top', filters: { order: 'ranked', limit: 10 }, top: true, see: { order: 'ranked' } },
  { id: 'ongoing', key: 'rows.ongoing', filters: { order: 'popularity', status: 'ongoing' }, see: { status: 'ongoing' } },
  { id: 'fresh', key: 'rows.fresh', filters: { order: 'aired_on', status: 'released' }, see: { order: 'aired_on' } },
  { id: 'upcoming', key: 'rows.upcoming', filters: { order: 'popularity', status: 'anons' }, see: { status: 'anons' } },
  { id: 'movies', key: 'rows.movies', filters: { order: 'popularity', kind: 'movie', status: 'released' }, see: { kind: 'movie', status: 'released' } },
  { id: 'action', key: 'rows.action', genre: 'Action' },
  { id: 'comedy', key: 'rows.comedy', genre: 'Comedy' },
  { id: 'romance', key: 'rows.romance', genre: 'Romance' },
  { id: 'fantasy', key: 'rows.fantasy', genre: 'Fantasy' },
];