import { PotokSDK } from 'potok-sdk';

const GRAPHQL_URL = 'https://shikimori.one/api/graphql';
const GENRES_URL = 'https://shikimori.one/api/genres?entry_type=Anime';
const ARM_URL = 'https://arm.haglund.dev/api/v2/ids?source=myanimelist&id=';
// Shikimori requires a descriptive User-Agent; the host proxy forwards request headers.
const HEADERS = { 'User-Agent': 'Potok-Shikimori', 'Content-Type': 'application/json' };

const ALLOWED_ORDER = ['popularity', 'ranked', 'aired_on', 'name', 'random'];
const ALLOWED_KIND = ['tv', 'movie', 'ova', 'ona', 'special'];
const ALLOWED_STATUS = ['anons', 'ongoing', 'released'];

function unwrap(res) {
  if (!res || res.status < 200 || res.status >= 300) return null;
  return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
}

// Escape a value for safe inline use inside a GraphQL string literal.
function gqlString(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Build the animes() query inline (avoids declaring variable enum types).
function buildAnimesQuery(f) {
  const args = [`limit: ${Math.min(Math.max(parseInt(f.limit, 10) || 20, 1), 50)}`, `page: ${Math.max(parseInt(f.page, 10) || 1, 1)}`];
  args.push(`order: ${ALLOWED_ORDER.includes(f.order) ? f.order : 'popularity'}`);
  if (f.kind && ALLOWED_KIND.includes(f.kind)) args.push(`kind: "${f.kind}"`);
  if (f.status && ALLOWED_STATUS.includes(f.status)) args.push(`status: "${f.status}"`);
  if (f.genre) args.push(`genre: "${gqlString(f.genre)}"`);
  if (f.season) args.push(`season: "${gqlString(f.season)}"`);
  if (f.search) args.push(`search: "${gqlString(f.search)}"`);
  return `{ animes(${args.join(', ')}) { id name russian kind status score poster { originalUrl mainUrl } } }`;
}

export async function fetchAnimes(filters) {
  try {
    const res = await PotokSDK.http.post(GRAPHQL_URL, { query: buildAnimesQuery(filters) }, HEADERS);
    const json = unwrap(res);
    return (json && json.data && json.data.animes) || [];
  } catch (e) {
    return [];
  }
}

export async function fetchGenres() {
  try {
    const list = unwrap(await PotokSDK.http.get(GENRES_URL, HEADERS));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function mediaTypeFromKind(kind) {
  return kind === 'movie' ? 'movie' : 'tv';
}

function shikiPoster(anime) {
  return (anime.poster && (anime.poster.mainUrl || anime.poster.originalUrl)) || undefined;
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
