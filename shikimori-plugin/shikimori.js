import { PotokSDK } from 'potok-sdk';

// Shikimori keeps changing domains (one -> me -> io, blocked in RU by turns). Try them in order and
// remember the one that answers. REST v1 is used instead of GraphQL: it's GET-only (no proxy POST/redirect
// or CORS issues) and covers catalog browsing fully.
const BASES = ['https://shikimori.io', 'https://shikimori.one', 'https://shikimori.me'];
const ARM_URL = 'https://arm.haglund.dev/api/v2/ids?source=myanimelist&id=';
// Shikimori requires a descriptive User-Agent; the host proxy forwards request headers.
const HEADERS = { 'User-Agent': 'Potok-Shikimori' };
const BASE_CACHE_KEY = 'shiki:base';

const ALLOWED_ORDER = ['popularity', 'ranked', 'aired_on', 'name', 'random'];
const ALLOWED_KIND = ['tv', 'movie', 'ova', 'ona', 'special'];
const ALLOWED_STATUS = ['anons', 'ongoing', 'released'];

let activeBase = null;

function unwrap(res) {
  if (!res || res.status < 200 || res.status >= 300) return null;
  return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
}

async function orderedBases() {
  if (!activeBase) activeBase = await PotokSDK.storage.local.getItem(BASE_CACHE_KEY);
  if (activeBase && BASES.includes(activeBase)) return [activeBase, ...BASES.filter((b) => b !== activeBase)];
  return BASES;
}

// GET a Shikimori REST path, trying domains until one answers; persist the working base.
async function shikiGet(path) {
  for (const base of await orderedBases()) {
    try {
      const json = unwrap(await PotokSDK.http.get(`${base}${path}`, HEADERS));
      if (json != null) {
        if (activeBase !== base) {
          activeBase = base;
          await PotokSDK.storage.local.setItem(BASE_CACHE_KEY, base);
        }
        return json;
      }
    } catch (e) { /* try next domain */ }
  }
  return null;
}

function currentBase() {
  return activeBase || BASES[0];
}

export async function fetchAnimes(filters) {
  const params = new URLSearchParams();
  params.set('limit', String(Math.min(Math.max(parseInt(filters.limit, 10) || 20, 1), 50)));
  params.set('page', String(Math.max(parseInt(filters.page, 10) || 1, 1)));
  params.set('order', ALLOWED_ORDER.includes(filters.order) ? filters.order : 'popularity');
  if (filters.kind && ALLOWED_KIND.includes(filters.kind)) params.set('kind', filters.kind);
  if (filters.status && ALLOWED_STATUS.includes(filters.status)) params.set('status', filters.status);
  if (filters.genre) params.set('genre', String(filters.genre));
  if (filters.season) params.set('season', String(filters.season));
  if (filters.search) params.set('search', String(filters.search));

  const list = await shikiGet(`/api/animes?${params.toString()}`);
  return Array.isArray(list) ? list : [];
}

export async function fetchGenres() {
  const list = await shikiGet('/api/genres');
  if (!Array.isArray(list)) return [];
  // v1 /api/genres returns both anime and manga genres.
  return list.filter((g) => !g.kind || g.kind === 'anime');
}

function mediaTypeFromKind(kind) {
  return kind === 'movie' ? 'movie' : 'tv';
}

function shikiPoster(anime) {
  const path = anime.image && (anime.image.original || anime.image.preview);
  if (!path) return undefined;
  return /^https?:/.test(path) ? path : `${currentBase()}${path}`;
}

// Shikimori exposes an IMDb link per anime. REST external_links is GET-only (proxy-safe, no CORS/POST),
// so we read it instead of GraphQL. Returns "ttXXXXXXX" or null.
async function fetchImdbId(animeId) {
  const links = await shikiGet(`/api/animes/${animeId}/external_links`);
  if (!Array.isArray(links)) return null;
  const imdb = links.find((l) => l && l.kind === 'imdb' && typeof l.url === 'string');
  if (!imdb) return null;
  const m = imdb.url.match(/(tt\d+)/);
  return m ? m[1] : null;
}

// Resolve an IMDb id -> full TMDB card via the gateway's TMDB API proxy (server key, host-relative, no CORS).
// We pull the poster/title/year/rating/backdrop FROM TMDB (Shikimori is only identity + fallback), so posters
// are always correct even when Shikimori lacks them.
async function tmdbFromImdb(imdbId, kind) {
  const res = unwrap(await PotokSDK.http.get(`/api/tmdb/find/${imdbId}?external_source=imdb_id`));
  if (!res) return null;
  const tv = Array.isArray(res.tv_results) ? res.tv_results[0] : null;
  const movie = Array.isArray(res.movie_results) ? res.movie_results[0] : null;
  const preferTv = kind !== 'movie';
  const pick = preferTv ? (tv || movie) : (movie || tv);
  if (!pick || !pick.id) return null;
  const date = pick.first_air_date || pick.release_date || '';
  return {
    id: Number(pick.id),
    mediaType: pick === tv ? 'tv' : 'movie',
    title: pick.name || pick.title,
    year: date ? date.slice(0, 4) : undefined,
    rating: typeof pick.vote_average === 'number' && pick.vote_average > 0 ? pick.vote_average : undefined,
    poster: pick.poster_path ? `https://image.tmdb.org/t/p/w500${pick.poster_path}` : undefined,
    backdrop: pick.backdrop_path ? `https://image.tmdb.org/t/p/w1280${pick.backdrop_path}` : undefined,
  };
}

// Map a Shikimori anime (its id == MyAnimeList id) to a clickable Potok card {id: tmdbId, mediaType}.
// Priority: IMDb->TMDB (reliable) -> ARM (mal->tmdb) -> gateway title search (fuzzy). Cached in storage
// since the relation is stable. Returns null when no TMDB match exists.
async function resolveTmdb(anime) {
  const cacheKey = `shiki:map2:${anime.id}`; // v2: now stores full TMDB card (poster/title/year/rating)
  const cached = await PotokSDK.storage.local.getItem(cacheKey);
  if (cached != null) {
    const parsed = JSON.parse(cached);
    return parsed || null;
  }

  let mapped = null;

  // 1) IMDb (from Shikimori) -> TMDB find. Most reliable + gives us the TMDB poster/title/year/rating.
  try {
    const imdbId = await fetchImdbId(anime.id);
    if (imdbId) mapped = await tmdbFromImdb(imdbId, anime.kind);
  } catch (e) { /* fall through */ }

  // 2) Fallback: gateway title search (fuzzy) — also returns a TMDB card (poster/title/rating).
  if (!mapped) {
    try {
      const name = anime.russian || anime.name;
      const results = unwrap(await PotokSDK.http.get(`/api/media/search?query=${encodeURIComponent(name)}`));
      const first = Array.isArray(results) ? results[0] : null;
      if (first && first.id) {
        mapped = {
          id: first.id,
          mediaType: first.mediaType || mediaTypeFromKind(anime.kind),
          title: first.title,
          poster: first.posterSrc,
          backdrop: first.backdropSrc,
          rating: first.tmdbRating,
        };
      }
    } catch (e) { /* fall through */ }
  }

  // 3) Last resort: ARM (MyAnimeList id -> themoviedb) — id only, poster comes from Shikimori.
  if (!mapped) {
    try {
      const arm = unwrap(await PotokSDK.http.get(`${ARM_URL}${anime.id}`));
      const tmdbId = arm && arm.themoviedb;
      if (tmdbId) mapped = { id: Number(tmdbId), mediaType: mediaTypeFromKind(anime.kind) };
    } catch (e) { /* no match */ }
  }

  await PotokSDK.storage.local.setItem(cacheKey, JSON.stringify(mapped || false));
  return mapped;
}

// Turn Shikimori anime into Potok cards, dropping ones with no TMDB match. Poster/title/rating come from
// TMDB (via mapped); Shikimori only fills gaps. Concurrency-limited by the host proxy.
export async function toCards(animes) {
  const cards = await Promise.all(animes.map(async (anime) => {
    const mapped = await resolveTmdb(anime);
    if (!mapped) return null;
    return {
      id: mapped.id,
      mediaType: mapped.mediaType,
      title: mapped.title || anime.russian || anime.name,
      posterSrc: mapped.poster || shikiPoster(anime),
      backdropSrc: mapped.backdrop,
      tmdbRating: mapped.rating != null ? mapped.rating : (anime.score ? Number(anime.score) : undefined),
      year: mapped.year,
    };
  }));
  return cards.filter(Boolean);
}
