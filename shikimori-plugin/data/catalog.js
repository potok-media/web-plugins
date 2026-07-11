import { state } from '../state.js';
import { CATALOG_LIMIT } from '../constants.js';
import { loadItems } from './cardAdapter.js';

let catalogToken = 0;

function catalogFilters(page) {
  return {
    order: state.order,
    genre: state.genre,
    search: state.query,
    status: state.status,
    kind: state.kind,
    page,
    limit: CATALOG_LIMIT,
  };
}

export async function loadCatalog(reset) {
  const token = ++catalogToken;
  if (reset) {
    state.page = 1;
    state.items = [];
    state.hasMore = true;
    state.catLoading = true;
  } else {
    state.loadingMore = true;
  }

  const page = reset ? 1 : state.page + 1;
  const { items, rawCount } = await loadItems(catalogFilters(page));
  if (token !== catalogToken) return;
  state.items = reset ? items : state.items.concat(items);
  state.page = page;
  state.hasMore = rawCount >= CATALOG_LIMIT;
  state.catLoading = false;
  state.loadingMore = false;
}