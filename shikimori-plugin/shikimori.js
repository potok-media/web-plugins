import { PotokSDK } from 'potok-sdk';

// Shikimori blocks cross-origin browser requests (no CORS) and rate-limits hard. So we:
//  1) go through the gateway's server-side proxy (/api/graphql via PotokSDK.http.proxy) — host-relative, no CORS;
//  2) use ONE GraphQL request per row that returns EVERYTHING a card needs (title, year, poster, score).
//
// Cards are drawn purely from Shikimori data — no TMDB during list rendering. TMDB is resolved LAZILY, once,
// only when the user clicks a card (see resolveTmdb), because the only thing that needs a TMDB id is opening
// the native /media/<type>/<id> page. This collapses a home load from ~50 requests to 4.
const BASES = ['https://shikimori.io'];
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
      const res = await PotokSDK.http.get(`${base}/api/graphql`, { method: 'POST', body: { query }, headers: HEADERS });
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

// One GraphQL request → everything a card renders from (year/poster/score) PLUS the keys we need later
// to resolve TMDB on click (english/russian name, kind, imdb link). No screenshots — keeps list complexity low.
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
      id malId name russian english kind score
      airedOn { year }
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
      imdb: imdbFromLinks(anime),
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

function pickBest(list, meta) {
  const want = mediaTypeFromKind(meta.kind);
  return (list.find((r) => r && r.id != null && r.mediaType === want)
    || list.find((r) => r && r.id != null)
    || null);
}

// Primary path for anime: title search (english first — far more reliable than IMDb, whose Shikimori link,
// when present at all, points at the whole franchise rather than this season). One request per name tried.
async function searchTmdb(meta) {
  const names = [];
  for (const n of [meta.english, meta.russian, meta.name]) {
    const name = n && String(n).trim();
    if (name && !names.includes(name)) names.push(name);
  }
  for (const name of names) {
    let results = null;
    try {
      results = unwrap(await PotokSDK.http.get(`/api/media/search?query=${encodeURIComponent(name)}`));
    } catch (e) { continue; }
    const list = Array.isArray(results) ? results : [];
    const pick = pickBest(list, meta);
    if (pick) return { id: Number(pick.id), mediaType: pick.mediaType || mediaTypeFromKind(meta.kind) };
  }
  return null;
}

// malId → cross-reference ids (themoviedb / imdb) via the ARM service (github.com/manami-project data).
// ONE proxied request per title, and — unlike a fuzzy TMDB title search — an exact mapping for anime.
async function armIds(malId) {
  if (malId == null) return null;
  try {
    const res = await PotokSDK.http.get(
      `https://arm.haglund.dev/api/v2/ids?source=myanimelist&id=${encodeURIComponent(malId)}&include=themoviedb,imdb`,
    );
    if (!res || res.status < 200 || res.status >= 300) return null;
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch (e) {
    return null;
  }
}

// Secondary path, only when title search misses and Shikimori happens to expose an IMDb link.
async function tmdbFromImdb(imdbId, kind) {
  const res = unwrap(await PotokSDK.http.get(`/api/tmdb/find/${imdbId}?external_source=imdb_id`));
  if (!res) return null;
  const tv = Array.isArray(res.tv_results) ? res.tv_results[0] : null;
  const movie = Array.isArray(res.movie_results) ? res.movie_results[0] : null;
  const preferTv = kind !== 'movie';
  const pick = preferTv ? (tv || movie) : (movie || tv);
  if (!pick || pick.id == null) return null;
  return { id: Number(pick.id), mediaType: pick === tv ? 'tv' : 'movie' };
}

// Resolve a Shikimori card → { id, mediaType } for /media/<type>/<id>. Cached in storage (relation is stable),
// so a title is resolved at most once ever. Returns null (and caches the miss) when nothing matches.
//
// Priority: malId → ARM → tmdb id (exact) ▸ imdb → tmdb find ▸ fuzzy title search (last resort). The old
// title-search-first path matched the wrong title for a lot of anime, hence the malId-first mapping.
export async function resolveTmdb(meta) {
  if (!meta || meta.shikiId == null) return null;
  const cacheKey = `shiki:tmdb2:${meta.shikiId}`; // v2: malId→ARM resolution (invalidates the old fuzzy cache)
  const cached = await PotokSDK.storage.local.getItem(cacheKey);
  if (cached != null) return JSON.parse(cached) || null;

  let hit = null;

  // 1) malId → ARM. themoviedb is a bare id with no type, so infer movie/tv from the Shikimori kind.
  const ids = await armIds(meta.malId);
  if (ids && ids.themoviedb) {
    hit = { id: Number(ids.themoviedb), mediaType: mediaTypeFromKind(meta.kind) };
  }
  // 2) imdb (ARM's, else Shikimori's link) → tmdb find.
  if (!hit) {
    const imdbId = (ids && typeof ids.imdb === 'string' ? ids.imdb : null) || meta.imdb;
    if (imdbId) {
      try { hit = await tmdbFromImdb(imdbId, meta.kind); } catch (e) { /* fall through */ }
    }
  }
  // 3) last resort: fuzzy title search.
  if (!hit) {
    try { hit = await searchTmdb(meta); } catch (e) { /* no match */ }
  }

  await PotokSDK.storage.local.setItem(cacheKey, JSON.stringify(hit || false));
  return hit;
}
