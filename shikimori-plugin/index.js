import { PotokSDK } from 'potok-sdk';
import { fetchAnimes, fetchGenres, toCards, resolveTmdb } from './shikimori.js';

const PAGE_ID = 'potok-shikimori';
const HOME_ID = 'potok-shikimori-home';
const CATALOG_LIMIT = 30;

const {
  VStack, HStack, Spacer, ContentRow, TopTenRow, PosterGrid,
  Scroller, SearchBar, Select, Skeleton, EmptyState,
  SidebarGroup, Button,
} = PotokSDK.ui.components;

const t = (key, opts) => PotokSDK.i18n.t(`potok-shikimori:${key}`, opts);

const state = PotokSDK.createState({
  // collections landing (shown by default, when no filter is active)
  colLoading: true,
  popular: [],
  top: [],
  ongoing: [],
  movies: [],
  // catalog
  query: '',
  order: 'popularity',
  genre: '',
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

async function loadCollections() {
  state.colLoading = true;
  const [popular, top, ongoing, movies] = await Promise.all([
    loadItems({ order: 'popularity', limit: 12 }),
    loadItems({ order: 'ranked', limit: 10 }),
    loadItems({ order: 'popularity', status: 'ongoing', limit: 12 }),
    loadItems({ order: 'popularity', kind: 'movie', status: 'released', limit: 12 }),
  ]);
  state.popular = popular.items;
  state.top = top.items;
  state.ongoing = ongoing.items;
  state.movies = movies.items;
  state.colLoading = false;
  renderHomeContribution();
}

// --- catalog (browse) ---------------------------------------------------------------

let searchTimer = null;

function catalogFilters(page) {
  return { order: state.order, genre: state.genre, search: state.query, page, limit: CATALOG_LIMIT };
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

// The single tab shows the collections landing by default and flips to the catalog grid the moment any
// filter is active — i.e. a search query, a picked genre, or any order other than the default "popular".
function isBrowsing() {
  return !!state.query || !!state.genre || state.order !== 'popularity';
}

function onSearch(value) {
  state.query = value;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { if (isBrowsing()) loadCatalog(true); }, 400);
}

function setOrder(order) {
  state.order = order;
  if (isBrowsing()) loadCatalog(true); // popular + no query/genre → back to the collections landing
}

function setGenre(id) {
  state.genre = id || '';
  if (isBrowsing()) loadCatalog(true);
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

  return HStack().spacing(12).alignItems('center').children([
    searchBox,
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

function collectionsSkeleton() {
  return VStack().spacing(20).children([
    Skeleton().height('20rem').rounded('1rem'),
    Skeleton().height('1.5rem').width('40%'),
    Scroller().orientation('horizontal').spacing(16).children(
      [0, 1, 2, 3, 4].map(() => Skeleton().width('10rem').height('15rem').rounded('0.75rem')),
    ),
  ]);
}

function buildCollections() {
  if (state.colLoading) return collectionsSkeleton();

  const children = [];

  if (state.popular.length) {
    children.push(
      ContentRow().id('shiki-popular').title(t('rows.popular')).items(state.popular).onCardClick(openItem),
    );
  }
  if (state.top.length) {
    children.push(TopTenRow().id('shiki-top').title(t('rows.top')).items(state.top).onCardClick(openItem));
  }
  if (state.ongoing.length) {
    children.push(
      ContentRow().id('shiki-ongoing').title(t('rows.ongoing')).items(state.ongoing).onCardClick(openItem),
    );
  }
  if (state.movies.length) {
    children.push(
      ContentRow().id('shiki-movies').title(t('rows.movies')).items(state.movies).onCardClick(openItem),
    );
  }

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
  const items = state.popular.slice(0, 12);
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
  render() {
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
      rows: { popular: 'Popular now', top: 'Top 10 by rating', ongoing: 'Airing now', movies: 'Anime movies', anime: 'Anime' },
      watch: 'Watch',
      details: 'Details',
      seeAll: 'See all',
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
      rows: { popular: 'Популярное сейчас', top: 'Топ-10 по рейтингу', ongoing: 'Онгоинги', movies: 'Аниме-фильмы', anime: 'Аниме' },
      watch: 'Смотреть',
      details: 'Подробнее',
      seeAll: 'Все',
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
