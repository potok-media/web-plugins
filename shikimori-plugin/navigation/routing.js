import { PotokSDK } from 'potok-sdk';
import { state } from '../state.js';
import {
  PAGE_PATH, ORDER_VALUES, STATUS_VALUES, KIND_VALUES,
} from '../constants.js';
import { loadCatalog } from '../data/catalog.js';

let searchTimer = null;

export function isBrowsing() {
  return state.browse;
}

export function filtersUrl(f) {
  const parts = [];
  if (f.query) parts.push(`q=${encodeURIComponent(f.query)}`);
  if (f.order) parts.push(`order=${encodeURIComponent(f.order)}`);
  if (f.genre) parts.push(`genre=${encodeURIComponent(String(f.genre))}`);
  if (f.status) parts.push(`status=${encodeURIComponent(f.status)}`);
  if (f.kind) parts.push(`kind=${encodeURIComponent(f.kind)}`);
  return parts.length ? `${PAGE_PATH}?${parts.join('&')}` : PAGE_PATH;
}

export function navigateFilters(overrides) {
  const next = {
    query: state.query,
    order: state.order,
    genre: state.genre,
    status: state.status,
    kind: state.kind,
    ...overrides,
  };
  PotokSDK.ui.navigateTo(filtersUrl(next));
}

export function goCollections() {
  PotokSDK.ui.navigateTo(PAGE_PATH);
}

export function applyRoute(props) {
  const q = (props && props.query) || {};
  const query = typeof q.q === 'string' ? q.q : '';
  const order = ORDER_VALUES.includes(q.order) ? q.order : 'popularity';
  const genre = q.genre != null && q.genre !== '' ? String(q.genre) : '';
  const status = STATUS_VALUES.includes(q.status) ? q.status : '';
  const kind = KIND_VALUES.includes(q.kind) ? q.kind : '';
  const browse = !!(q.q || q.order || q.genre || q.status || q.kind);
  const changed = query !== state.query || order !== state.order || genre !== state.genre
    || status !== state.status || kind !== state.kind;
  const enteringBrowse = browse && !state.browse;

  state.query = query;
  state.order = order;
  state.genre = genre;
  state.status = status;
  state.kind = kind;
  state.browse = browse;

  if (browse && (changed || enteringBrowse)) loadCatalog(true);
}

export function onSearch(value) {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => navigateFilters({ query: value }), 400);
}

export function setOrder(order) {
  navigateFilters({ order });
}

export function setGenre(id) {
  navigateFilters({ genre: id || '' });
}