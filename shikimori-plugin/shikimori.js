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

// Map a Shikimori anime (its id == MyAnimeList id) to a clickable Potok card {id: tmdbId, mediaType, ...}.
// Cached in local storage since the id relation is stable. Returns null when no TMDB match exists.
async function resolveTmdb(anime) {
  const cacheKey = `shiki:map:${anime.id}`;
  const cached = await PotokSDK.storage.local.getItem(cacheKey);
  if (cached != null) {
    const parsed = JSON.parse(cached);
    return parsed || null;
  }

  let mapped = null;
  try {
    const arm = unwrap(await PotokSDK.http.get(`${ARM_URL}${anime.id}`));
    const tmdbId = arm && arm.themoviedb;
    if (tmdbId) mapped = { id: Number(tmdbId), mediaType: mediaTypeFromKind(anime.kind) };
  } catch (e) { /* fall through to search */ }

  if (!mapped) {
    // Fallback: our gateway search resolves title -> TMDB card (host-relative, proxied with auth).
    try {
      const name = anime.russian || anime.name;
      const results = unwrap(await PotokSDK.http.get(`/api/media/search?query=${encodeURIComponent(name)}`));
      const first = Array.isArray(results) ? results[0] : null;
      if (first && first.id) mapped = { id: first.id, mediaType: first.mediaType || mediaTypeFromKind(anime.kind), posterSrc: first.posterSrc };
    } catch (e) { /* no match */ }
  }

  await PotokSDK.storage.local.setItem(cacheKey, JSON.stringify(mapped || false));
  return mapped;
}

// Turn Shikimori anime into Potok cards, dropping ones with no TMDB match. Concurrency-limited by the host proxy.
export async function toCards(animes) {
  const cards = await Promise.all(animes.map(async (anime) => {
    const mapped = await resolveTmdb(anime);
    if (!mapped) return null;
    return {
      id: mapped.id,
      mediaType: mapped.mediaType,
      title: anime.russian || anime.name,
      posterSrc: mapped.posterSrc || shikiPoster(anime),
      tmdbRating: anime.score ? Number(anime.score) : undefined,
    };
  }));
  return cards.filter(Boolean);
}
