import { state } from '../state.js';
import { SHELVES, SHELF_TTL, SHELF_REQUEST_DELAY } from '../constants.js';
import { readCache, writeCache } from './cache.js';
import { rememberCard } from './cardMeta.js';
import { cardToItem, loadItems } from './cardAdapter.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function genreId(name) {
  const g = state.genres.find((x) => x && String(x.name || '').toLowerCase() === name.toLowerCase());
  return g ? String(g.id) : null;
}

function shelfFilters(s) {
  if (s.genre) {
    const id = genreId(s.genre);
    return id ? { order: 'popularity', genre: id, limit: 12 } : null;
  }
  return { limit: 12, ...s.filters };
}

export function shelfSee(s) {
  if (s.genre) {
    const id = genreId(s.genre);
    return id ? { genre: id } : {};
  }
  return s.see || {};
}

async function loadShelf(s) {
  const cacheKey = `shiki:shelf1:${s.id}`;
  const cachedCards = await readCache(cacheKey, SHELF_TTL);
  if (Array.isArray(cachedCards)) {
    cachedCards.forEach(rememberCard);
    return { items: cachedCards.map(cardToItem), fetched: false };
  }
  const filters = shelfFilters(s);
  if (!filters) return { items: [], fetched: false };
  const { items, cards } = await loadItems(filters);
  await writeCache(cacheKey, cards);
  return { items, fetched: true };
}

export async function loadCollections(onPopularLoaded) {
  state.shelves = {};
  for (const s of SHELVES) {
    const { items, fetched } = await loadShelf(s);
    state.shelves = { ...state.shelves, [s.id]: items };
    if (s.id === 'popular' && onPopularLoaded) onPopularLoaded();
    if (fetched) await sleep(SHELF_REQUEST_DELAY);
  }
  if (onPopularLoaded) onPopularLoaded();
}