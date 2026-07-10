import { PotokSDK } from 'potok-sdk';

// Shikimori blocks cross-origin browser requests (no CORS) and rate-limits hard. So we:
//  1) go through the gateway's server-side proxy (/api/proxy?url=) — host-relative, no CORS;
//  2) use ONE GraphQL request per row that returns the list + each anime's IMDb link at once,
//     instead of a REST list + N per-anime external_links calls (which got us rate-limit banned).
const BASES = ['https://shikimori.one', 'https://shikimori.io', 'https://shikimori.me'];
const ARM_URL = 'https://arm.haglund.dev/api/v2/ids?source=myanimelist&id=';
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

// POST a GraphQL query to Shikimori via the proxy, trying domains until one answers; persist the working base.
async function shikiGraphql(query) {
  for (const base of await orderedBases()) {
    try {
      const res = await PotokSDK.http.proxy(`${base}/api/graphql`, { method: 'POST', body: { query }, headers: HEADERS });
      if (res && res.status >= 200 && res.status < 300) {
        const json = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        if (json && json.data) {
          if (activeBase !== base) {
            activeBase = base;
            await PotokSDK.storage.local.setItem(BASE_CACHE_KEY, base);
          }
          return json.data;
        }
      }
    } catch (e) { /* try next domain */ }
  }
  return null;
}

// One GraphQL request → animes with id/malId/name/kind/score/poster AND their external links (IMDb).
export async function fetchAnimes(filters) {
  const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 20, 1), 50);
  const page = Math.max(parseInt(filters.page, 10) || 1, 1);
  const order = ALLOWED_ORDER.includes(filters.order) ? filters.order : 'popularity';

  const args = [`page: ${page}`, `limit: ${limit}`, `order: ${order}`];
  if (filters.kind && ALLOWED_KIND.includes(filters.kind)) args.push(`kind: ${JSON.stringify(filters.kind)}`);
  if (filters.status && ALLOWED_STATUS.includes(filters.status)) args.push(`status: ${JSON.stringify(filters.status)}`);
  if (filters.genre) args.push(`genre: ${JSON.stringify(String(filters.genre))}`);
  if (filters.search) args.push(`search: ${JSON.stringify(String(filters.search))}`);

  const query = `{
    animes(${args.join(', ')}) {
      id malId name russian kind score
      poster { originalUrl mainUrl }
      externalLinks { kind url }
    }
  }`;

  const data = await shikiGraphql(query);
  return data && Array.isArray(data.animes) ? data.animes : [];
}

export async function fetchGenres() {
  const data = await shikiGraphql(`{ genres(entryType: Anime) { id russian name } }`);
  return data && Array.isArray(data.genres) ? data.genres : [];
}

function mediaTypeFromKind(kind) {
  return kind === 'movie' ? 'movie' : 'tv';
}

function shikiPoster(anime) {
  const p = anime.poster;
  return (p && (p.originalUrl || p.mainUrl)) || undefined;
}

function imdbFromLinks(anime) {
  const link = (anime.externalLinks || []).find((l) => l && l.kind === 'imdb' && typeof l.url === 'string');
  if (!link) return null;
  const m = link.url.match(/(tt\d+)/);
  return m ? m[1] : null;
}

// Resolve an IMDb id -> full TMDB card via the gateway's TMDB API proxy (server key, host-relative, no CORS).
// We pull poster/title/year/rating/backdrop FROM TMDB (Shikimori is only identity + fallback).
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

// Priority: IMDb->TMDB (reliable) -> gateway title search (fuzzy) -> ARM (mal->tmdb). Cached in storage.
async function resolveTmdb(anime) {
  const cacheKey = `shiki:map2:${anime.id}`; // v2: stores the full TMDB card
  const cached = await PotokSDK.storage.local.getItem(cacheKey);
  if (cached != null) {
    const parsed = JSON.parse(cached);
    return parsed || null;
  }

  let mapped = null;

  // 1) IMDb from the already-batched externalLinks (no extra Shikimori request) -> TMDB find.
  const imdbId = imdbFromLinks(anime);
  if (imdbId) {
    try { mapped = await tmdbFromImdb(imdbId, anime.kind); } catch (e) { /* fall through */ }
  }

  // 2) Fallback: gateway title search (host-relative, fuzzy) — also returns a TMDB card.
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

  // 3) Last resort: ARM (MyAnimeList id -> themoviedb) via proxy — id only, poster comes from Shikimori.
  if (!mapped && anime.malId) {
    try {
      const arm = unwrap(await PotokSDK.http.proxy(`${ARM_URL}${anime.malId}`));
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
