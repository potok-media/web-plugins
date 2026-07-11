import { fetchGenres } from '../shikimori.js';
import { GENRES_TTL } from '../constants.js';
import { readCache, writeCache } from './cache.js';

export async function loadGenres() {
  const cached = await readCache('shiki:genres1', GENRES_TTL);
  if (Array.isArray(cached)) return cached;
  const genres = await fetchGenres();
  if (genres.length) await writeCache('shiki:genres1', genres);
  return genres;
}