import { PotokSDK } from 'potok-sdk';
import { CATALOG_LIMIT } from './constants.js';

// Shikimori blocks cross-origin browser requests (no CORS) and rate-limits hard. So we:
//  1) go through the gateway's server-side proxy (/api/graphql via PotokSDK.http.proxy) — host-relative, no CORS;
//  2) use ONE GraphQL request per row that returns EVERYTHING a card needs (title, year, poster, score).
//
// Cards are drawn purely from Shikimori data — no TMDB during list rendering. TMDB is resolved LAZILY, once,
// only when the user clicks a card: our ARM graph answers first (see resolve/armNav.js), the title search
// below is only the fallback for titles the graph does not cover. This collapses a home load from ~50
// requests to 4.
const BASES = ['https://shikimori.io']; // add more domains here for failover if one goes down
const HEADERS = { 'User-Agent': 'Potok-Shikimori' };

const ALLOWED_ORDER = ['popularity', 'ranked', 'aired_on', 'name', 'random'];
const ALLOWED_KIND = ['tv', 'movie', 'ova', 'ona', 'special'];
const ALLOWED_STATUS = ['anons', 'ongoing', 'released'];

function unwrap(res) {
  if (!res || res.status < 200 || res.status >= 300) return null;
  return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
}

// POST a GraphQL query to Shikimori, trying each domain until one answers.
async function shikiGraphql(query) {
  for (const base of BASES) {
    try {
      const res = await PotokSDK.http.post(`${base}/api/graphql`, { query }, HEADERS);
      if (res && res.status >= 200 && res.status < 300) {
        const json = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        if (json && json.data) return json.data;
      }
    } catch (e) { /* try next domain */ }
  }
  return null;
}

// One GraphQL request → everything a card renders from (year/poster/score) PLUS the keys we need later
// to resolve TMDB on click (malId + english/russian name, kind). No screenshots — keeps list complexity low.
export async function fetchAnimes(filters) {
  const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 20, 1), CATALOG_LIMIT);
  const page = Math.max(parseInt(filters.page, 10) || 1, 1);
  const order = ALLOWED_ORDER.includes(filters.order) ? filters.order : 'popularity';

  const args = [`page: ${page}`, `limit: ${limit}`, `order: ${order}`];
  if (filters.kind && ALLOWED_KIND.includes(filters.kind)) args.push(`kind: ${JSON.stringify(filters.kind)}`);
  if (filters.status && ALLOWED_STATUS.includes(filters.status)) args.push(`status: ${JSON.stringify(filters.status)}`);
  if (filters.genre) args.push(`genre: ${JSON.stringify(String(filters.genre))}`);
  if (filters.search) args.push(`search: ${JSON.stringify(String(filters.search))}`);

  const query = `{
    animes(${args.join(', ')}) {
      id malId name russian english kind score
      airedOn { year }
      poster { originalUrl mainUrl }
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

// Subtitle = year only (straight from Shikimori, no extra request).
function buildSubtitle(year) {
  return year ? String(year) : undefined;
}

// Shikimori anime → display card. Carries both the render fields AND the meta needed to resolve TMDB on click.
// Synchronous and network-free: the whole row is already in hand from fetchAnimes.
export function toCards(animes) {
  return (animes || []).map((anime) => {
    if (!anime || anime.id == null) return null;
    const year = anime.airedOn && anime.airedOn.year;
    return {
      // resolution meta (used lazily by resolveTmdb)
      shikiId: anime.id,
      malId: anime.malId,
      kind: anime.kind,
      name: anime.name,
      english: anime.english,
      russian: anime.russian,
      year,
      // display fields
      mediaType: mediaTypeFromKind(anime.kind),
      title: anime.russian || anime.name,
      subtitle: buildSubtitle(year),
      posterSrc: shikiPoster(anime),
      rating: anime.score ? Number(anime.score) : undefined,
    };
  }).filter(Boolean);
}

// --- TMDB resolution: LAZY, on click only -------------------------------------------

function tmdbCacheKey(shikiId) {
  return `shiki:tmdb:${shikiId}`;
}

export async function hasCachedTmdb(shikiId) {
  if (shikiId == null) return false;
  const cached = await PotokSDK.storage.local.getItem(tmdbCacheKey(shikiId));
  if (cached == null) return false;
  try {
    const hit = JSON.parse(cached);
    return !!(hit && hit.id != null);
  } catch (e) {
    return false;
  }
}

export async function cacheTmdbChoice(shikiId, hit) {
  if (shikiId == null || !hit || hit.id == null) return;
  await PotokSDK.storage.local.setItem(tmdbCacheKey(shikiId), JSON.stringify({
    id: Number(hit.id),
    mediaType: hit.mediaType,
  }));
}

export async function clearCachedTmdb(shikiId) {
  if (shikiId == null) return;
  await PotokSDK.storage.local.removeItem(tmdbCacheKey(shikiId));
}

/** Gate before navigation/cache for search- and cache-sourced hits — they can 404 on TMDB detail. */
export async function verifyTmdbHit(hit) {
  if (!hit || hit.id == null || !hit.mediaType) return false;
  try {
    const res = await PotokSDK.http.get(`/api/media/detail/${hit.mediaType}/${hit.id}`);
    if (!res || res.status < 200 || res.status >= 300) return false;
    const d = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    return !!(d && d.id != null);
  } catch (e) {
    return false;
  }
}

async function commitDirectHit(meta, hit, { cache = false, fromCache = false } = {}) {
  if (!await verifyTmdbHit(hit)) {
    if (fromCache) await clearCachedTmdb(meta.shikiId);
    return null;
  }
  if (cache) await cacheTmdbChoice(meta.shikiId, hit);
  return hit;
}

function toCandidate(item, meta) {
  if (!item || item.id == null) return null;
  return {
    id: Number(item.id),
    mediaType: item.mediaType || mediaTypeFromKind(meta.kind),
    title: item.title || item.originalTitle || item.englishTitle || '',
    subtitle: item.subtitle || undefined,
    posterSrc: item.posterSrc,
    tmdbRating: item.tmdbRating,
    imdbRating: item.imdbRating,
    kpRating: item.kpRating,
  };
}

function dedupeCandidates(list) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const key = `${c.mediaType}:${c.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

/** Shikimori kind → the only TMDB bucket we consider (no mixed movie/tv picker). */
function expectedMediaType(meta) {
  return mediaTypeFromKind(meta.kind);
}

function filterByKind(candidates, meta) {
  const want = expectedMediaType(meta);
  return candidates.filter((c) => c.mediaType === want);
}

// Fallback title search on TMDB — Shikimori names only, same-type filter. Runs ONLY when the ARM graph missed.
export async function searchTmdbCandidates(meta) {
  const names = [];
  for (const n of [meta.russian, meta.title, meta.english, meta.name]) {
    const name = n && String(n).trim();
    if (name && !names.includes(name)) names.push(name);
  }
  if (!names.length) return [];
  const collected = [];
  for (const name of names) {
    let results = null;
    try {
      results = unwrap(await PotokSDK.http.get(`/api/media/search?query=${encodeURIComponent(name)}`));
    } catch (e) { continue; }
    const list = Array.isArray(results) ? results : [];
    for (const item of list) {
      const c = toCandidate(item, meta);
      if (c) collected.push(c);
    }
  }
  return filterByKind(dedupeCandidates(collected), meta);
}

// Cache-only direct hit, verified against TMDB before navigation. The ARM graph resolve lives in
// resolve/armNav.js; this is the fast path for a title the user already opened or picked.
export async function resolveCachedTmdb(meta) {
  if (!meta || meta.shikiId == null) return null;
  const cached = await PotokSDK.storage.local.getItem(tmdbCacheKey(meta.shikiId));
  if (cached == null) return null;
  try {
    const hit = JSON.parse(cached);
    if (hit && hit.id != null) {
      const verified = await commitDirectHit(meta, hit, { fromCache: true });
      if (verified) return verified;
    }
  } catch (e) { /* re-resolve */ }
  return null;
}

// Fallback: TMDB title search by Shikimori names (+ picker on ambiguity). Runs ONLY when both the
// cached hit and the ARM graph missed.
export async function resolveTmdbOpen(meta) {
  if (!meta || meta.shikiId == null) return { kind: 'none' };

  const cachedHit = await resolveCachedTmdb(meta);
  if (cachedHit) return { kind: 'direct', hit: cachedHit, fromCache: true };

  let candidates = [];
  try {
    candidates = await searchTmdbCandidates(meta);
  } catch (e) { /* no match */ }

  if (candidates.length === 0) return { kind: 'none' };
  if (candidates.length === 1) {
    const verified = await commitDirectHit(meta, candidates[0], { cache: true });
    if (verified) return { kind: 'direct', hit: verified };
    return { kind: 'none' };
  }
  return { kind: 'choose', candidates };
}

// Thin wrapper — returns first hit or null (no user picker).
export async function resolveTmdb(meta) {
  const result = await resolveTmdbOpen(meta);
  if (result.kind === 'direct') return result.hit;
  if (result.kind === 'choose' && result.candidates.length) return result.candidates[0];
  return null;
}
