import { PotokSDK } from 'potok-sdk';
import { fetchAnimes, fetchGenres, toCards, resolveTmdb } from './shikimori.js';

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
  SidebarGroup, Button,
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
});

// --- data → SDKContentItem adapters -------------------------------------------------

// Shiki id → full card (resolution meta) so the click handler can turn it into a TMDB id on demand. The item
// that round-trips the sandbox bridge only keeps the typed SDKContentItem fields, so we can't stash meta on it.
const cardMeta = new Map();

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
  cards.forEach((c) => cardMeta.set(String(c.shikiId), c));
  return { items: cards.map(cardToItem), rawCount: animes.length };
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

// Load shelves ONE AT A TIME with a delay between requests (bursting 10 gets us rate-limited/banned).
// A shelf stays `undefined` until it lands → buildCollections shows a skeleton row for it in the meantime;
// each finished shelf drops in progressively (or is skipped if it came back empty).
async function loadCollections() {
  state.shelves = {};
  for (const s of SHELVES) {
    await sleep(SHELF_REQUEST_DELAY); // space out from the previous request (incl. the genres fetch)
    const filters = shelfFilters(s);
    const items = filters ? (await loadItems(filters)).items : [];
    state.shelves = { ...state.shelves, [s.id]: items }; // new ref → re-render; row pops in
    if (s.id === 'popular') renderHomeContribution(); // native home row can update early
  }
  renderHomeContribution();
}

// --- catalog (browse) ---------------------------------------------------------------

let searchTimer = null;

function catalogFilters(page) {
  return {
    order: state.order, genre: state.genre, search: state.query,
    status: state.status, kind: state.kind, page, limit: CATALOG_LIMIT,
  };
}

async function loadCatalog(reset) {
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
  state.items = reset ? items : state.items.concat(items);
  state.page = page;
  state.hasMore = rawCount >= CATALOG_LIMIT;
  state.catLoading = false;
  state.loadingMore = false;
}

// Click = resolve TMDB for THIS one title (cached after first time), then open the native page. The only place
// a TMDB request happens. Guarded so a double-tap doesn't fire two lookups.
let opening = false;
async function openItem(item) {
  if (!item || item.id == null || opening) return;
  const meta = cardMeta.get(String(item.id));
  if (!meta) return;
  opening = true;
  try {
    const tmdb = await resolveTmdb(meta);
    if (tmdb && tmdb.id != null) {
      PotokSDK.ui.navigateTo(`/media/${tmdb.mediaType || meta.mediaType}/${tmdb.id}`);
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
  state.query = query;
  state.order = order;
  state.genre = genre;
  state.status = status;
  state.kind = kind;
  state.browse = browse;
  if (browse && changed) loadCatalog(true);
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

// Toolbar (always on top): search on the left (compact, like the page's main search), order + genre selects
// centered. The SDK search hard-sets width:100%, so we cap it by nesting in a fixed-width box; the flanking
// Spacers (flex-grow:1) center the two selects in the space to its right.
function toolbar() {
  const genreOptions = [{ value: '', label: t('filters.anyGenre') }];
  state.genres.forEach((g) => genreOptions.push({ value: String(g.id), label: g.russian || g.name }));

  const searchBox = HStack().width('28rem').children([
    SearchBar('shiki-search').placeholder(t('searchPlaceholder')).value(state.query)
      .onChange(onSearch).onClear(() => onSearch('')),
  ]);

  const left = [];
  if (isBrowsing()) {
    left.push(Button(t('backToCollections')).variant('secondary').icon('arrow-left').onClick(goCollections));
  }
  left.push(searchBox);

  return HStack().spacing(12).alignItems('center').children([
    ...left,
    Spacer(),
    Select('shiki-order').variant('glass').icon('arrow-down-wide-narrow')
      .value(state.order)
      .options([
        { value: 'popularity', label: t('order.popularity') },
        { value: 'ranked', label: t('order.ranked') },
        { value: 'aired_on', label: t('order.aired') },
      ])
      .onChange((v) => setOrder(Array.isArray(v) ? v[0] : v)),
    Select('shiki-genre').variant('glass').icon('tag')
      .value(state.genre)
      .options(genreOptions)
      .onChange((v) => setGenre(Array.isArray(v) ? v[0] : v)),
    Spacer(),
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
  return VStack().id('shiki-root').spacing(20).children([
    toolbar(),
    isBrowsing() ? buildCatalogResults() : buildCollections(),
  ]);
}

// --- home-page contribution (Phase 3): a "popular anime" row on the native home ------

function homeRowLayout() {
  const items = (state.shelves.popular || []).slice(0, 12);
  if (!items.length) return VStack().id('shiki-home-empty');
  return ContentRow().id('shiki-home-row').title(t('rows.popular')).items(items)
    .seeAllLabel(t('seeAll')).onCardClick(openItem)
    .onSeeAllClick(() => PotokSDK.ui.navigateTo(`/extensions/${PAGE_ID}`));
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
      .onClick(() => PotokSDK.ui.navigateTo(`/extensions/${PAGE_ID}`));
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
      return { label: t('rows.popular'), layout: homeRowLayout() };
    },
  });
}

state.$subscribe(() => {
  PotokSDK.ui.render(buildLayout(), PAGE_ID);
});

PotokSDK.i18n.registerTranslations({
  en: {
    'potok-shikimori': {
      manifest: { name: 'Anime (Shikimori)' },
      pageTitle: 'Anime — Shikimori',
      sidebar: { title: 'Anime', catalog: 'Shikimori' },
      view: { collections: 'Collections', catalog: 'Catalog' },
      rows: {
        popular: 'Popular now', top: 'Top 10 by rating', ongoing: 'Airing now',
        fresh: 'Fresh releases', upcoming: 'Coming soon', movies: 'Anime movies',
        action: 'Action', comedy: 'Comedy', romance: 'Romance', fantasy: 'Fantasy', anime: 'Anime',
      },
      watch: 'Watch',
      details: 'Details',
      seeAll: 'See all',
      backToCollections: 'Collections',
      loadMore: 'Load more',
      searchPlaceholder: 'Search anime…',
      empty: 'Nothing found',
      emptyHint: 'Try another query or genre.',
      notFound: 'No match found for this title',
      filters: { anyGenre: 'All' },
      order: { popularity: 'Popular', ranked: 'Rating', aired: 'Newest' },
    },
  },
  ru: {
    'potok-shikimori': {
      manifest: { name: 'Аниме (Shikimori)' },
      pageTitle: 'Аниме — Shikimori',
      sidebar: { title: 'Аниме', catalog: 'Shikimori' },
      view: { collections: 'Подборки', catalog: 'Каталог' },
      rows: {
        popular: 'Популярное сейчас', top: 'Топ-10 по рейтингу', ongoing: 'Онгоинги',
        fresh: 'Свежие релизы', upcoming: 'Скоро выйдет', movies: 'Аниме-фильмы',
        action: 'Экшен', comedy: 'Комедия', romance: 'Романтика', fantasy: 'Фэнтези', anime: 'Аниме',
      },
      watch: 'Смотреть',
      details: 'Подробнее',
      seeAll: 'Все',
      backToCollections: 'Подборки',
      loadMore: 'Показать ещё',
      searchPlaceholder: 'Поиск аниме…',
      empty: 'Ничего не найдено',
      emptyHint: 'Попробуйте другой запрос или жанр.',
      notFound: 'Не нашли совпадение для этого тайтла',
      filters: { anyGenre: 'Все' },
      order: { popularity: 'Популярное', ranked: 'Рейтинг', aired: 'Новинки' },
    },
  },
});

// Initial load: genres + collections.
(async () => {
  state.genres = await fetchGenres();
  await loadCollections();
})();
