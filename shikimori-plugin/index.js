import { PotokSDK } from 'potok-sdk';
import { fetchAnimes, fetchGenres, toCards } from './shikimori.js';

const PAGE_ID = 'potok-shikimori';
const HOME_ID = 'potok-shikimori-home';
const CATALOG_LIMIT = 30;

const {
  VStack, HStack, Segmented, Hero, ContentRow, TopTenRow, PosterGrid,
  Scroller, Chip, SearchBar, Skeleton, EmptyState, Spacer, Heading,
} = PotokSDK.ui.components;

const t = (key, opts) => PotokSDK.i18n.t(`potok-shikimori:${key}`, opts);

const state = PotokSDK.createState({
  view: 'collections',        // 'collections' | 'catalog'
  // collections
  colLoading: true,
  featured: null,
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

function cardToItem(card) {
  return {
    id: card.id,
    mediaType: card.mediaType,
    title: card.title,
    image: card.posterSrc,
    badges: card.tmdbRating ? [{ text: '★ ' + Number(card.tmdbRating).toFixed(1), color: 'accent' }] : [],
  };
}

async function loadItems(filters) {
  const animes = await fetchAnimes(filters);
  const cards = await toCards(animes);
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
  state.featured = popular.items[0] || null;
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

function openItem(item) {
  if (item && item.id) PotokSDK.ui.navigateTo(`/media/${item.mediaType || 'tv'}/${item.id}`);
}

function goCatalog(preset) {
  state.view = 'catalog';
  if (preset) {
    state.order = preset.order || state.order;
    state.genre = preset.genre != null ? preset.genre : state.genre;
    state.query = '';
  }
  loadCatalog(true);
}

function onSearch(value) {
  state.query = value;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadCatalog(true), 400);
}

function setOrder(order) {
  state.order = order;
  loadCatalog(true);
}

function toggleGenre(id) {
  state.genre = state.genre === id ? '' : id;
  loadCatalog(true);
}

// --- view builders ------------------------------------------------------------------

function viewSwitch() {
  return Segmented()
    .id('shiki-view')
    .items([
      { id: 'collections', label: t('view.collections') },
      { id: 'catalog', label: t('view.catalog') },
    ])
    .value(state.view)
    .onChange((v) => {
      state.view = v;
      if (v === 'catalog' && !state.items.length && !state.catLoading) loadCatalog(true);
    });
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

  if (state.featured) {
    children.push(
      Hero()
        .id('shiki-hero')
        .items([{
          id: state.featured.id,
          title: state.featured.title,
          subtitle: t('heroSubtitle'),
          image: state.featured.image,
          badges: state.featured.badges,
        }])
        .playLabel(t('watch'))
        .detailsLabel(t('details'))
        .onPlay(() => openItem(state.featured))
        .onDetails(() => openItem(state.featured)),
    );
  }

  if (state.popular.length) {
    children.push(
      ContentRow().id('shiki-popular').title(t('rows.popular')).items(state.popular)
        .seeAllLabel(t('seeAll')).onCardClick(openItem)
        .onSeeAllClick(() => goCatalog({ order: 'popularity' })),
    );
  }
  if (state.top.length) {
    children.push(TopTenRow().id('shiki-top').title(t('rows.top')).items(state.top).onCardClick(openItem));
  }
  if (state.ongoing.length) {
    children.push(
      ContentRow().id('shiki-ongoing').title(t('rows.ongoing')).items(state.ongoing)
        .seeAllLabel(t('seeAll')).onCardClick(openItem)
        .onSeeAllClick(() => goCatalog({ order: 'popularity' })),
    );
  }
  if (state.movies.length) {
    children.push(
      ContentRow().id('shiki-movies').title(t('rows.movies')).items(state.movies)
        .seeAllLabel(t('seeAll')).onCardClick(openItem)
        .onSeeAllClick(() => goCatalog({ order: 'popularity' })),
    );
  }

  return VStack().spacing(24).children(children);
}

function genreChips() {
  const chips = [Chip(t('filters.anyGenre')).active(!state.genre).onClick(() => toggleGenre(''))];
  state.genres.slice(0, 24).forEach((g) => {
    const id = String(g.id);
    chips.push(Chip(g.russian || g.name).active(state.genre === id).onClick(() => toggleGenre(id)));
  });
  return Scroller().orientation('horizontal').spacing(8).children(chips);
}

function catalogSkeletonGrid() {
  return HStack().spacing(16).children(
    [0, 1, 2, 3, 4, 5].map(() => Skeleton().width('10rem').height('15rem').rounded('0.75rem')),
  );
}

function buildCatalog() {
  const controls = VStack().spacing(12).children([
    SearchBar('shiki-search').placeholder(t('searchPlaceholder')).value(state.query)
      .onChange(onSearch).onClear(() => onSearch('')),
    Segmented().id('shiki-order').value(state.order)
      .items([
        { id: 'popularity', label: t('order.popularity') },
        { id: 'ranked', label: t('order.ranked') },
        { id: 'aired_on', label: t('order.aired') },
      ])
      .onChange(setOrder),
    genreChips(),
  ]);

  let results;
  if (state.catLoading) {
    results = catalogSkeletonGrid();
  } else if (!state.items.length) {
    results = EmptyState().icon('search-x').title(t('empty')).description(t('emptyHint'));
  } else {
    const grid = PosterGrid().id('shiki-grid').items(state.items).minWidth('10rem').onCardClick(openItem);
    if (state.hasMore) grid.loadMoreLabel(t('loadMore')).onLoadMore(() => loadCatalog(false));
    results = grid;
  }

  return VStack().spacing(16).children([controls, results]);
}

function buildLayout() {
  return VStack().id('shiki-root').spacing(20).children([
    HStack().alignItems('center').children([Heading(t('pageTitle')), Spacer()]),
    viewSwitch(),
    state.view === 'catalog' ? buildCatalog() : buildCollections(),
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
      view: { collections: 'Collections', catalog: 'Catalog' },
      rows: { popular: 'Popular now', top: 'Top 10 by rating', ongoing: 'Airing now', movies: 'Anime movies', anime: 'Anime' },
      heroSubtitle: 'Featured anime of the week',
      watch: 'Watch',
      details: 'Details',
      seeAll: 'See all',
      loadMore: 'Load more',
      searchPlaceholder: 'Search anime…',
      empty: 'Nothing found',
      emptyHint: 'Try another query or genre.',
      filters: { anyGenre: 'All' },
      order: { popularity: 'Popular', ranked: 'Rating', aired: 'Newest' },
    },
  },
  ru: {
    'potok-shikimori': {
      manifest: { name: 'Аниме (Shikimori)' },
      pageTitle: 'Аниме — Shikimori',
      view: { collections: 'Подборки', catalog: 'Каталог' },
      rows: { popular: 'Популярное сейчас', top: 'Топ-10 по рейтингу', ongoing: 'Онгоинги', movies: 'Аниме-фильмы', anime: 'Аниме' },
      heroSubtitle: 'Аниме недели',
      watch: 'Смотреть',
      details: 'Подробнее',
      seeAll: 'Все',
      loadMore: 'Показать ещё',
      searchPlaceholder: 'Поиск аниме…',
      empty: 'Ничего не найдено',
      emptyHint: 'Попробуйте другой запрос или жанр.',
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
