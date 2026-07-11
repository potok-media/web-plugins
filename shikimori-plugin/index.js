import { PotokSDK } from 'potok-sdk';
import {
  fetchAnimes, fetchGenres, toCards,
  resolveTmdbOpen, hasCachedTmdb, cacheTmdbChoice,
} from './shikimori.js';

const PAGE_ID = 'potok-shikimori';
const PAGE_PATH = `/extensions/${PAGE_ID}`;
const HOME_ID = 'potok-shikimori-home';
const CATALOG_LIMIT = 30;
const ORDER_VALUES = ['popularity', 'ranked', 'aired_on'];
const STATUS_VALUES = ['anons', 'ongoing', 'released'];
const KIND_VALUES = ['tv', 'movie', 'ova', 'ona', 'special'];

const {
  VStack, HStack, Spacer, ContentRow, TopTenRow, PosterGrid,
  Scroller, SearchBar, Select, Skeleton, EmptyState,
  SidebarGroup, Button, Card, Text, Heading, Modal,
} = PotokSDK.ui.components;

const t = (key, opts) => PotokSDK.i18n.t(`potok-shikimori:${key}`, opts);

const state = PotokSDK.createState({
  // collections landing (shown by default, when no filter is active)
  shelves: {}, // shelf id -> items[] (see SHELVES); undefined = still loading, [] = loaded-empty
  // catalog / browse filters (mirror of the URL — see applyRoute)
  query: '',
  order: 'popularity',
  genre: '',
  status: '',
  kind: '',
  browse: false, // true = show the catalog grid (any URL filter present); false = collections landing
  page: 1,
  items: [],
  catLoading: false,
  loadingMore: false,
  hasMore: true,
  genres: [],
  pickerOpen: false,
  pickerItems: [],
  pickerShikiId: null,
});

const RESOLVE_HUD_MS = 3000;

// --- data → SDKContentItem adapters -------------------------------------------------

// Shiki id → full card (resolution meta) so the click handler can turn it into a TMDB id on demand. The item
// that round-trips the sandbox bridge only keeps the typed SDKContentItem fields, so we can't stash meta on it.
// Bounded LRU so a long browsing session can't grow it without limit; the cap is far above what's on screen,
// and access refreshes recency, so a card that's still visible/clickable is never the one evicted.
const CARD_META_MAX = 1000;
const cardMeta = new Map();

function rememberCard(card) {
  const key = String(card.shikiId);
  cardMeta.delete(key); // re-insert at the end (most-recent)
  cardMeta.set(key, card);
  if (cardMeta.size > CARD_META_MAX) cardMeta.delete(cardMeta.keys().next().value); // evict oldest
}

function getCard(id) {
  const key = String(id);
  const card = cardMeta.get(key);
  if (card) { cardMeta.delete(key); cardMeta.set(key, card); } // touch → most-recent
  return card;
}

// SDKContentItem — the host renders it via the app's NATIVE MediaCard (rating pill, poster, type icon). Now
// drawn entirely from Shikimori (subtitle "year • genres", poster, score). The id is the Shikimori id: TMDB is
// unknown until the user clicks (see openItem), so default /media/<type>/<id> navigation must NOT fire here.
function cardToItem(card) {
  return {
    id: card.shikiId,
    mediaType: card.mediaType,
    title: card.title,
    subtitle: card.subtitle,
    image: card.posterSrc,
    rating: card.rating,
  };
}

async function loadItems(filters) {
  const animes = await fetchAnimes(filters);
  const cards = toCards(animes);
  cards.forEach(rememberCard);
  return { items: cards.map(cardToItem), cards, rawCount: animes.length };
}

const SHELF_TTL = 1 * 24 * 60 * 60 * 1000;       // 1d — landing shelves refresh a few times a day
const GENRES_TTL = 7 * 24 * 60 * 60 * 1000; // 7d — the genre list barely changes

async function readCache(key, ttlMs) {
  try {
    const raw = await PotokSDK.storage.local.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ts !== 'number' || Date.now() - parsed.ts > ttlMs) return null;
    return parsed.data;
  } catch (e) {
    return null;
  }
}

async function writeCache(key, data) {
  try {
    await PotokSDK.storage.local.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch (e) { /* storage full/unavailable → just refetch next time */ }
}

// --- collections landing ------------------------------------------------------------

// Landing shelves — each is ONE simple fetchAnimes call (order/status/kind/genre only). `see` is the filter
// the shelf's "see all →" opens in the catalog; genre shelves resolve their id from the loaded genre list.
// `top: true` renders the ranked Top-10 row. Order here = order on the page.
const SHELVES = [
  { id: 'popular',  key: 'rows.popular',  filters: { order: 'popularity' },                       see: { order: 'popularity' } },
  { id: 'top',      key: 'rows.top',      filters: { order: 'ranked', limit: 10 }, top: true,      see: { order: 'ranked' } },
  { id: 'ongoing',  key: 'rows.ongoing',  filters: { order: 'popularity', status: 'ongoing' },     see: { status: 'ongoing' } },
  { id: 'fresh',    key: 'rows.fresh',    filters: { order: 'aired_on', status: 'released' },       see: { order: 'aired_on' } },
  { id: 'upcoming', key: 'rows.upcoming', filters: { order: 'popularity', status: 'anons' },        see: { status: 'anons' } },
  { id: 'movies',   key: 'rows.movies',   filters: { order: 'popularity', kind: 'movie', status: 'released' }, see: { kind: 'movie', status: 'released' } },
  { id: 'action',   key: 'rows.action',   genre: 'Action' },
  { id: 'comedy',   key: 'rows.comedy',   genre: 'Comedy' },
  { id: 'romance',  key: 'rows.romance',  genre: 'Romance' },
  { id: 'fantasy',  key: 'rows.fantasy',  genre: 'Fantasy' },
];

// Resolve a Shikimori genre id from its English name (from the loaded genres list).
function genreId(name) {
  const g = state.genres.find((x) => x && String(x.name || '').toLowerCase() === name.toLowerCase());
  return g ? String(g.id) : null;
}

// fetchAnimes filters for a shelf (null → skip, e.g. a genre we couldn't resolve).
function shelfFilters(s) {
  if (s.genre) {
    const id = genreId(s.genre);
    return id ? { order: 'popularity', genre: id, limit: 12 } : null;
  }
  return { limit: 12, ...s.filters };
}

// The filter override a shelf's "see all →" navigates to.
function shelfSee(s) {
  if (s.genre) {
    const id = genreId(s.genre);
    return id ? { genre: id } : {};
  }
  return s.see || {};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELF_REQUEST_DELAY = 250; // ms between shelf requests — Shikimori rate-limits fast bursts hard

// Load one shelf, preferring the persistent cache. Returns { items, fetched } — `fetched` = a real Shikimori
// request happened (so the caller knows whether to space out the next one). Caches the full cards so a reload
// also repopulates cardMeta (needed to resolve TMDB on click) without any network.
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

// Fill the landing. Cache hits are instant (no request, no delay); only ACTUAL requests are spaced out, so a
// warm reload hits Shikimori zero times. A shelf stays `undefined` until it lands → skeleton row meanwhile.
async function loadCollections() {
  state.shelves = {};
  for (const s of SHELVES) {
    const { items, fetched } = await loadShelf(s);
    state.shelves = { ...state.shelves, [s.id]: items }; // new ref → re-render; row pops in
    if (s.id === 'popular') renderHomeContribution(); // native home row can update early
    if (fetched) await sleep(SHELF_REQUEST_DELAY); // space out only real requests (rate-limit guard)
  }
  renderHomeContribution();
}

// Genres, also cached (they barely change) — one fewer Shikimori request on reload.
async function loadGenres() {
  const cached = await readCache('shiki:genres1', GENRES_TTL);
  if (Array.isArray(cached)) return cached;
  const genres = await fetchGenres();
  if (genres.length) await writeCache('shiki:genres1', genres);
  return genres;
}

// --- catalog (browse) ---------------------------------------------------------------

let searchTimer = null;

function catalogFilters(page) {
  return {
    order: state.order, genre: state.genre, search: state.query,
    status: state.status, kind: state.kind, page, limit: CATALOG_LIMIT,
  };
}

let catalogToken = 0;

async function loadCatalog(reset) {
  const token = ++catalogToken; // any newer load (filter change, back/forward) invalidates this one
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
  if (token !== catalogToken) return; // superseded — drop this result so it can't clobber the current one
  state.items = reset ? items : state.items.concat(items);
  state.page = page;
  state.hasMore = rawCount >= CATALOG_LIMIT;
  state.catLoading = false;
  state.loadingMore = false;
}

// Flip to false to silence the resolution tracing once the mapping is trusted.
const DEBUG_RESOLVE = true;

// Fetch the resolved TMDB title so we can eyeball whether malId→tmdb landed on the right thing.
async function debugTmdbTitle(mediaType, id) {
  try {
    const res = await PotokSDK.http.get(`/api/media/detail/${mediaType}/${id}?language=ru`);
    const d = res && (typeof res.data === 'string' ? JSON.parse(res.data) : res.data);
    return d ? (d.title || d.name || d.originalTitle || d.originalName || '(no title)') : '(empty)';
  } catch (e) {
    return `(detail fetch failed: ${e && e.message})`;
  }
}

function navigateToTmdb(hit, fallbackMediaType) {
  if (!hit || hit.id == null) return;
  PotokSDK.ui.navigateTo(`/media/${hit.mediaType || fallbackMediaType}/${hit.id}`);
}

function closePicker() {
  state.pickerOpen = false;
  state.pickerItems = [];
  state.pickerShikiId = null;
}

function candidateToPickerItem(c) {
  return {
    id: c.id,
    mediaType: c.mediaType,
    title: c.title || `#${c.id}`,
    subtitle: c.subtitle,
    image: c.posterSrc,
    rating: c.tmdbRating || c.imdbRating || c.kpRating,
  };
}

async function onPickerSelect(card) {
  if (!card || card.id == null) return;
  const pick = state.pickerItems.find(
    (c) => c.id === Number(card.id) && c.mediaType === (card.mediaType || 'tv'),
  );
  if (!pick) return;
  const shikiId = state.pickerShikiId;
  await cacheTmdbChoice(shikiId, pick);
  closePicker();
  navigateToTmdb(pick);
}

function pickerHint() {
  const type = state.pickerItems[0] && state.pickerItems[0].mediaType;
  return type === 'movie' ? t('picker.hintMovie') : t('picker.hintTv');
}

function buildPickerModal() {
  if (!state.pickerOpen || !state.pickerItems.length) return null;
  // Host Modal = empty shell (backdrop + panel + ESC). All chrome and layout live in the plugin tree.
  return Modal()
    .open(true)
    .variant('modal')
    .closeOnBackdrop(true)
    .onClose(closePicker)
    .child(
      VStack().spacing(12).width('100%').children([
        Heading(t('picker.title')).level(3),
        Text(pickerHint()).variant('secondary'),
        Scroller()
          .orientation('vertical')
          .height('min(58vh, 38rem)')
          .width('100%')
          .child(
            PosterGrid()
              .items(state.pickerItems.map(candidateToPickerItem))
              .minWidth('9.5rem')
              .onCardClick(onPickerSelect),
          ),
      ]),
    );
}

// Click = resolve TMDB for THIS one title (cached after first time), then open the native page. The only place
// a TMDB request happens. Guarded so a double-tap doesn't fire two lookups.
let opening = false;
async function openItem(item) {
  if (!item || item.id == null || opening) return;
  const meta = getCard(item.id);
  if (!meta) return;
  opening = true;
  try {
    const cached = await hasCachedTmdb(meta.shikiId);
    if (!cached) {
      PotokSDK.ui.showHUD('info', t('resolving'), { durationMs: RESOLVE_HUD_MS });
    }

    const result = await resolveTmdbOpen(meta);

    if (DEBUG_RESOLVE) {
      const chain = {
        shikiId: meta.shikiId, malId: meta.malId, kind: meta.kind,
        ru: meta.russian, en: meta.english, name: meta.name,
        kind: result.kind,
        fromCache: result.fromCache || false,
        candidatesCount: result.candidates ? result.candidates.length : 0,
        hit: result.hit || null,
      };
      if (result.kind === 'direct' && result.hit && result.hit.id != null) {
        chain.tmdbTitle = await debugTmdbTitle(result.hit.mediaType || meta.mediaType, result.hit.id);
      }
      // eslint-disable-next-line no-console
      console.log('[shikimori] resolve', chain);
    }

    if (result.kind === 'direct' && result.hit) {
      navigateToTmdb(result.hit, meta.mediaType);
    } else if (result.kind === 'choose' && result.candidates.length) {
      state.pickerShikiId = meta.shikiId;
      state.pickerItems = result.candidates;
      state.pickerOpen = true;
    } else {
      PotokSDK.ui.showHUD('warning', t('notFound'));
    }
  } finally {
    opening = false;
  }
}

// Collections landing vs catalog grid. Browsing = the URL carries any filter (see applyRoute); the bare
// page path (/extensions/potok-shikimori) is the landing. Reached via the sidebar, browser Back, or the
// "back to collections" button.
function isBrowsing() {
  return state.browse;
}

// --- URL as the source of truth for filters -----------------------------------------
// Filter state lives in the page URL (?q=&order=&genre=&status=&kind=), NOT only in local state — so browser
// back/forward move between catalog states, and category "see all" is just a navigation to a filtered URL.
// Changing a filter navigates (pushing a history entry); the host feeds the new query back as slot props,
// and applyRoute() mirrors it into state before each render.

function filtersUrl(f) {
  const parts = [];
  if (f.query) parts.push(`q=${encodeURIComponent(f.query)}`);
  if (f.order) parts.push(`order=${encodeURIComponent(f.order)}`);
  if (f.genre) parts.push(`genre=${encodeURIComponent(String(f.genre))}`);
  if (f.status) parts.push(`status=${encodeURIComponent(f.status)}`);
  if (f.kind) parts.push(`kind=${encodeURIComponent(f.kind)}`);
  return parts.length ? `${PAGE_PATH}?${parts.join('&')}` : PAGE_PATH;
}

// Navigate to the grid with the given filter overrides on top of the current ones (pushes history).
function navigateFilters(overrides) {
  const next = {
    query: state.query, order: state.order, genre: state.genre,
    status: state.status, kind: state.kind, ...overrides,
  };
  PotokSDK.ui.navigateTo(filtersUrl(next));
}

// Navigate to the plain landing (curated collections).
function goCollections() {
  PotokSDK.ui.navigateTo(PAGE_PATH);
}

// Sync state from the URL query the host passes in props; kick off a catalog load when the (browsing)
// filters actually changed. Called at the top of every slot render — including on back/forward.
function applyRoute(props) {
  const q = (props && props.query) || {};
  const query = typeof q.q === 'string' ? q.q : '';
  const order = ORDER_VALUES.includes(q.order) ? q.order : 'popularity';
  const genre = q.genre != null && q.genre !== '' ? String(q.genre) : '';
  const status = STATUS_VALUES.includes(q.status) ? q.status : '';
  const kind = KIND_VALUES.includes(q.kind) ? q.kind : '';
  const browse = !!(q.q || q.order || q.genre || q.status || q.kind);
  const changed = query !== state.query || order !== state.order || genre !== state.genre
    || status !== state.status || kind !== state.kind;
  // Landing → catalog with default filters (e.g. ?order=popularity) leaves changed=false — still load.
  const enteringBrowse = browse && !state.browse;
  state.query = query;
  state.order = order;
  state.genre = genre;
  state.status = status;
  state.kind = kind;
  state.browse = browse;
  if (browse && (changed || enteringBrowse)) loadCatalog(true);
}

function onSearch(value) {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => navigateFilters({ query: value }), 400);
}

function setOrder(order) {
  navigateFilters({ order });
}

function setGenre(id) {
  navigateFilters({ genre: id || '' });
}

// --- view builders ------------------------------------------------------------------

// Toolbar (always on top): compact search on the left, order + genre selects pinned right (one Spacer between).
// The search is sized directly via .width() — the SDK now honours it, no wrapper box needed.
function toolbar() {
  const genreOptions = [{ value: '', label: t('filters.anyGenre') }];
  state.genres.forEach((g) => genreOptions.push({ value: String(g.id), label: g.russian || g.name }));

  const search = SearchBar('shiki-search').placeholder(t('searchPlaceholder')).value(state.query)
    .onChange(onSearch).onClear(() => onSearch('')).width('28rem');

  const left = [];
  if (isBrowsing()) {
    left.push(Button(t('backToCollections')).variant('glass').icon('arrow-left').onClick(goCollections));
  }
  left.push(search);

  // Layout: [← Home?] [search] ……… [sort] [genre] — filters pinned to the right (one Spacer), search left.
  // resetValue = the default, so the glass "active filter" dot only lights up for a NON-default choice
  // (otherwise "Популярное"/"Все" glow as if a filter were applied — misleading).
  return HStack().spacing(12).alignItems('center').children([
    ...left,
    Spacer(),
    Select('shiki-order').variant('glass').icon('arrow-down-wide-narrow')
      .value(state.order)
      .resetValue('popularity')
      .options([
        { value: 'popularity', label: t('order.popularity') },
        { value: 'ranked', label: t('order.ranked') },
        { value: 'aired_on', label: t('order.aired') },
      ])
      .onChange((v) => setOrder(Array.isArray(v) ? v[0] : v)),
    Select('shiki-genre').variant('glass').icon('tag')
      .value(state.genre)
      .resetValue('')
      .options(genreOptions)
      .onChange((v) => setGenre(Array.isArray(v) ? v[0] : v)),
  ]);
}

// A single loading row: the real category title + a strip of skeleton cards, shown while the shelf is still
// in flight (rate-limited sequential loading means later shelves take a moment to arrive).
function shelfSkeleton(s) {
  return VStack().spacing(12).children([
    Skeleton().height('1.25rem').width('12rem').rounded('0.5rem'),
    Scroller().orientation('horizontal').spacing(16).children(
      [0, 1, 2, 3, 4, 5].map(() => Skeleton().width('10rem').height('15rem').rounded('0.75rem')),
    ),
  ]);
}

function buildCollections() {
  const children = [];
  // Render shelves in SHELVES order. Not-yet-loaded (undefined) → skeleton row; loaded-empty → skip.
  SHELVES.forEach((s) => {
    const items = state.shelves[s.id];
    if (items === undefined) {
      children.push(shelfSkeleton(s));
      return;
    }
    if (!items.length) return;
    const Row = s.top ? TopTenRow : ContentRow;
    children.push(
      Row().id(`shiki-${s.id}`).title(t(s.key)).items(items).onCardClick(openItem)
        .seeAllLabel(t('seeAll')).onSeeAllClick(() => navigateFilters(shelfSee(s))),
    );
  });

  return VStack().spacing(24).children(children);
}

function catalogSkeletonGrid() {
  return HStack().spacing(16).children(
    [0, 1, 2, 3, 4, 5].map(() => Skeleton().width('10rem').height('15rem').rounded('0.75rem')),
  );
}

// The catalog grid (results only — the toolbar lives above it, shared with the collections view).
function buildCatalogResults() {
  if (state.catLoading) return catalogSkeletonGrid();
  if (!state.items.length) return EmptyState().icon('search-x').title(t('empty')).description(t('emptyHint'));
  const grid = PosterGrid().id('shiki-grid').items(state.items).onCardClick(openItem);
  if (state.hasMore) grid.onLoadMore(() => loadCatalog(false)); // auto-loads on scroll (SDK sentinel)
  return grid;
}

function buildLayout() {
  const children = [
    toolbar(),
    isBrowsing() ? buildCatalogResults() : buildCollections(),
  ];
  const picker = buildPickerModal();
  if (picker) children.push(picker);
  return VStack().id('shiki-root').spacing(20).children(children);
}

// --- home-page contribution (Phase 3): a "popular anime" row on the native home ------

function homeRowLayout() {
  const items = (state.shelves.popular || []).slice(0, 12);
  if (!items.length && !state.pickerOpen) return VStack().id('shiki-home-empty');
  const children = [];
  if (items.length) {
    // On the NATIVE home the row is branded "Shikimori" so its "see all →" clearly leads to the plugin's
    // home page (not a "Popular" filter). The plugin's own page keeps the "Популярное сейчас" shelf as-is.
    children.push(
      ContentRow().id('shiki-home-row').title(t('homeRow')).items(items)
        .seeAllLabel(t('seeAll')).onCardClick(openItem)
        .onSeeAllClick(() => PotokSDK.ui.navigateTo(PAGE_PATH)),
    );
  }
  const picker = buildPickerModal();
  if (picker) children.push(picker);
  return VStack().id('shiki-home-wrap').children(children);
}

function renderHomeContribution() {
  PotokSDK.ui.render(homeRowLayout(), HOME_ID);
}

// --- registration -------------------------------------------------------------------

PotokSDK.registerSlotContribution({
  id: PAGE_ID,
  slotName: 'extension-page',
  render(props) {
    applyRoute(props);
    return { label: t('manifest.name'), layout: buildLayout() };
  },
});

// Own sidebar CATEGORY (like "МЕДИАТЕКА") with the entry point to this page.
// Falls back to a plain sidebar button if the host is older and lacks SidebarGroup.
PotokSDK.registerSlotContribution({
  id: 'potok-shikimori-sidebar',
  slotName: SidebarGroup ? 'sidebar-groups' : 'sidebar-menu',
  render() {
    const catalog = Button(t('sidebar.catalog'))
      .variant('sidebar-item')
      .icon('clapperboard')
      .onClick(() => PotokSDK.ui.navigateTo(PAGE_PATH));
    const layout = SidebarGroup
      ? SidebarGroup(t('sidebar.title')).child(catalog)
      : catalog;
    return { label: t('sidebar.title'), layout };
  },
});

if (typeof PotokSDK.registerHomeSection === 'function') {
  PotokSDK.registerHomeSection({
    id: HOME_ID,
    position: 'top',
    render() {
      return { label: t('homeRow'), layout: homeRowLayout() };
    },
  });
}

// Settings tab: a manual cache reset (shelves + genres + TMDB resolutions live in storage.local).
async function resetCache() {
  await PotokSDK.storage.local.clear();
  cardMeta.clear();
  state.shelves = {};                    // → skeletons on the page until refetch lands
  state.genres = await loadGenres();     // cache cleared → refetches
  await loadCollections();               // refetches all shelves
  PotokSDK.ui.showHUD('success', t('settings.cacheCleared'));
}

function settingsLayout() {
  // Spacing is owned by the plugin via SDK style props (.padding / .spacing / .width) — NO host CSS needed.
  // These serialize to inline --sdk-* vars that override the component's default styling.
  return Card()
    .padding([20, 22])            // comfy inner padding (overrides .potok-card default)
    .width('100%')
    .title(t('settings.title'))
    .subtitle(t('settings.subtitle'))
    .child(
      VStack().spacing(16).children([
        Text(t('settings.cacheDesc')).variant('secondary'),
        // Wrap in an HStack so the button sizes to its content (a VStack stretches children full-width → an
        // ugly edge-to-edge bar).
        HStack().children([
          Button(t('settings.clearCache')).variant('secondary').icon('trash-2').onClick(resetCache),
        ]),
      ]),
    );
}

PotokSDK.registerSlotContribution({
  id: 'potok-shikimori-settings',
  slotName: 'settings-tabs',
  render() {
    return { label: t('settings.title'), layout: settingsLayout() };
  },
});

state.$subscribe(() => {
  PotokSDK.ui.render(buildLayout(), PAGE_ID);
  renderHomeContribution();
});

PotokSDK.i18n.registerTranslations({
  en: {
    'potok-shikimori': {
      manifest: { name: 'Anime (Shikimori)' },
      sidebar: { title: 'Anime', catalog: 'Shikimori' },
      rows: {
        popular: 'Popular now', top: 'Top 10 by rating', ongoing: 'Airing now',
        fresh: 'Fresh releases', upcoming: 'Coming soon', movies: 'Anime movies',
        action: 'Action', comedy: 'Comedy', romance: 'Romance', fantasy: 'Fantasy', anime: 'Anime',
      },
      seeAll: 'See all',
      homeRow: 'Shikimori',
      backToCollections: 'Home',
      settings: {
        title: 'Shikimori',
        subtitle: 'Plugin cache',
        cacheDesc: 'Shelves, genres and title→TMDB mappings are cached locally. Clear it if a title opens the wrong page or the feed looks stale.',
        clearCache: 'Clear cache',
        cacheCleared: 'Shikimori cache cleared',
      },
      searchPlaceholder: 'Search anime…',
      empty: 'Nothing found',
      emptyHint: 'Try another query or genre.',
      notFound: 'No match found for this title',
      resolving: 'Looking for a match, please wait…',
      picker: {
        title: 'Choose a match',
        hintTv: 'Several TV series found — pick the one that fits this title.',
        hintMovie: 'Several movies found — pick the one that fits this title.',
      },
      filters: { anyGenre: 'All' },
      order: { popularity: 'Popular', ranked: 'Rating', aired: 'Newest' },
    },
  },
  ru: {
    'potok-shikimori': {
      manifest: { name: 'Аниме (Shikimori)' },
      sidebar: { title: 'Аниме', catalog: 'Shikimori' },
      rows: {
        popular: 'Популярное сейчас', top: 'Топ-10 по рейтингу', ongoing: 'Онгоинги',
        fresh: 'Свежие релизы', upcoming: 'Скоро выйдет', movies: 'Аниме-фильмы',
        action: 'Экшен', comedy: 'Комедия', romance: 'Романтика', fantasy: 'Фэнтези', anime: 'Аниме',
      },
      seeAll: 'Все',
      homeRow: 'Shikimori',
      backToCollections: 'Главная',
      settings: {
        title: 'Shikimori',
        subtitle: 'Кэш плагина',
        cacheDesc: 'Полки, жанры и сопоставления тайтл→TMDB кэшируются локально. Сбрось, если тайтл открывает не ту страницу или лента выглядит устаревшей.',
        clearCache: 'Сбросить кэш',
        cacheCleared: 'Кэш Shikimori очищен',
      },
      searchPlaceholder: 'Поиск аниме…',
      empty: 'Ничего не найдено',
      emptyHint: 'Попробуйте другой запрос или жанр.',
      notFound: 'Не нашли совпадение для этого тайтла',
      resolving: 'Ищем совпадение, подождите…',
      picker: {
        title: 'Выберите совпадение',
        hintTv: 'Найдено несколько сериалов — выберите подходящий к этому тайтлу.',
        hintMovie: 'Найдено несколько фильмов — выберите подходящий к этому тайтлу.',
      },
      filters: { anyGenre: 'Все' },
      order: { popularity: 'Популярное', ranked: 'Рейтинг', aired: 'Новинки' },
    },
  },
});

// Initial load: genres + collections (both served from the persistent cache when warm → no Shikimori hits).
(async () => {
  state.genres = await loadGenres();
  await loadCollections();
})();
