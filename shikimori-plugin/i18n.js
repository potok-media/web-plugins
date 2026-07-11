import { PotokSDK } from 'potok-sdk';

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