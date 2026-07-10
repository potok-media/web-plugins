import { PotokSDK } from 'potok-sdk';
import { fetchAnimes, fetchGenres, toCards } from './shikimori.js';

const PAGE_ID = 'potok-shikimori';
const { VStack, HStack, Heading, SearchBar, Select, LoadingSpinner, MediaRow } = PotokSDK.ui.components;

const t = (key, opts) => PotokSDK.i18n.t(`potok-shikimori:${key}`, opts);

const state = PotokSDK.createState({
  query: '',
  order: 'popularity',
  kind: '',
  status: '',
  genre: '',
  loading: true,
  cards: [],
  genres: [],
});

let searchTimer = null;

function currentFilters() {
  return { order: state.order, kind: state.kind, status: state.status, genre: state.genre, search: state.query, limit: 40 };
}

async function reload() {
  state.loading = true;
  const animes = await fetchAnimes(currentFilters());
  state.cards = await toCards(animes);
  state.loading = false;
}

function onSearch(value) {
  state.query = value;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { reload(); }, 400);
}

function setFilter(field, value) {
  state[field] = value;
  reload();
}

function selectOption(value, label) {
  return { value, label };
}

function buildKindSelect() {
  return Select().label(t('filters.kind')).variant('glass').value(state.kind)
    .options([
      selectOption('', t('filters.any')),
      selectOption('tv', t('kind.tv')),
      selectOption('movie', t('kind.movie')),
      selectOption('ova', t('kind.ova')),
      selectOption('ona', t('kind.ona')),
      selectOption('special', t('kind.special')),
    ])
    .onChange((v) => setFilter('kind', String(v)));
}

function buildStatusSelect() {
  return Select().label(t('filters.status')).variant('glass').value(state.status)
    .options([
      selectOption('', t('filters.any')),
      selectOption('anons', t('status.anons')),
      selectOption('ongoing', t('status.ongoing')),
      selectOption('released', t('status.released')),
    ])
    .onChange((v) => setFilter('status', String(v)));
}

function buildOrderSelect() {
  return Select().label(t('filters.order')).variant('glass').value(state.order)
    .options([
      selectOption('popularity', t('order.popularity')),
      selectOption('ranked', t('order.ranked')),
      selectOption('aired_on', t('order.aired')),
      selectOption('name', t('order.name')),
      selectOption('random', t('order.random')),
    ])
    .onChange((v) => setFilter('order', String(v)));
}

function buildGenreSelect() {
  const options = [selectOption('', t('filters.anyGenre'))].concat(
    state.genres.map((g) => selectOption(String(g.id), g.russian || g.name)),
  );
  return Select().label(t('filters.genre')).variant('glass').value(state.genre)
    .options(options)
    .onChange((v) => setFilter('genre', String(v)));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function openCard(card) {
  if (card && card.id) PotokSDK.ui.navigateTo(`/media/${card.mediaType || 'tv'}/${card.id}`);
}

// The host MediaRow caps at ~10 cards, so render the catalog as several rows to show the whole page.
function buildResults() {
  if (state.loading) return LoadingSpinner();
  if (!state.cards.length) return Heading(t('empty'));
  return VStack().spacing(16).children(
    chunk(state.cards, 10).map((group, i) =>
      MediaRow().title(i === 0 ? t('resultsTitle') : '').items(group).onCardClick(openCard),
    ),
  );
}

function buildLayout() {
  return VStack().spacing(20).children([
    Heading(t('pageTitle')),
    SearchBar('shikimori-search').placeholder(t('searchPlaceholder')).value(state.query).onChange(onSearch),
    HStack().spacing(12).children([buildKindSelect(), buildStatusSelect(), buildOrderSelect(), buildGenreSelect()]),
    buildResults(),
  ]);
}

// --- Registration ---

PotokSDK.registerSlotContribution({
  id: PAGE_ID,
  slotName: 'extension-page',
  render() {
    return { label: t('manifest.name'), layout: buildLayout() };
  },
});

state.$subscribe(() => {
  PotokSDK.ui.render(buildLayout(), PAGE_ID);
});

// Feed provider: hide the backend anime row and put our own "Anime" category in its place,
// whose title click opens this page.
if (PotokSDK.feed && typeof PotokSDK.feed.registerFeedProvider === 'function') {
  PotokSDK.feed.registerFeedProvider({
    id: 'shikimori',
    name: 'Shikimori',
    category: 'catalog',
    hiddenCategories: ['discover.anime'],
    async getFeed() {
      const animes = await fetchAnimes({ order: 'popularity', kind: 'tv', status: 'released', limit: 12 });
      const items = await toCards(animes);
      return {
        rows: [
          { id: 'anime', title: 'potok-shikimori:rows.anime', items, pageId: PAGE_ID, replaces: 'discover.anime' },
        ],
      };
    },
  });
}

// Plugin i18n (its own data — not subject to the repo's English-only rule).
PotokSDK.i18n.registerTranslations({
  en: {
    'potok-shikimori': {
      manifest: { name: 'Anime (Shikimori)' },
      rows: { anime: 'Anime' },
      pageTitle: 'Anime — Shikimori',
      searchPlaceholder: 'Search anime…',
      resultsTitle: 'Results',
      empty: 'Nothing found',
      filters: { kind: 'Type', status: 'Status', order: 'Sort', genre: 'Genre', any: 'Any', anyGenre: 'Any genre' },
      kind: { tv: 'TV series', movie: 'Movie', ova: 'OVA', ona: 'ONA', special: 'Special' },
      status: { anons: 'Announced', ongoing: 'Airing', released: 'Released' },
      order: { popularity: 'Popularity', ranked: 'Rating', aired: 'Air date', name: 'Name', random: 'Random' },
    },
  },
  ru: {
    'potok-shikimori': {
      manifest: { name: 'Аниме (Shikimori)' },
      rows: { anime: 'Аниме' },
      pageTitle: 'Аниме — Shikimori',
      searchPlaceholder: 'Поиск аниме…',
      resultsTitle: 'Результаты',
      empty: 'Ничего не найдено',
      filters: { kind: 'Тип', status: 'Статус', order: 'Сортировка', genre: 'Жанр', any: 'Любой', anyGenre: 'Любой жанр' },
      kind: { tv: 'ТВ-сериал', movie: 'Фильм', ova: 'OVA', ona: 'ONA', special: 'Спешл' },
      status: { anons: 'Анонс', ongoing: 'Онгоинг', released: 'Вышло' },
      order: { popularity: 'Популярность', ranked: 'Рейтинг', aired: 'Дата выхода', name: 'Название', random: 'Случайно' },
    },
  },
});

// Initial load: genres + first page.
(async () => {
  state.genres = await fetchGenres();
  await reload();
})();
