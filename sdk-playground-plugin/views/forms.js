import { PotokSDK } from 'potok-sdk';

const { VStack, HStack, Card, Text, Divider, SearchBar, MediaCard, LoadingSpinner } = PotokSDK.ui.components;

export function buildFormsCard(state, setSearchQuery) {
  const query = (state.searchQuery || "").trim();

  let searchResults;

  if (state.searchLoading) {
    // Отображаем красивый системный лоадер во время сетевого запроса
    searchResults = LoadingSpinner()
      .message("Выполняется поиск по базе данных TMDB...")
      .height("120px");
  } else if (query) {
    if (state.searchResults && state.searchResults.length > 0) {
      searchResults = HStack()
        .spacing(16)
        .children(
          state.searchResults.map(movie => 
            MediaCard()
              .id(`search-result-card-${movie.id}`) // Стабильный ID для предотвращения пересоздания DOM
              .item({
                id: movie.id,
                title: movie.title,
                subtitle: movie.subtitle || movie.originalTitle || "",
                mediaType: movie.mediaType || "movie",
                posterSrc: movie.posterSrc,
                tmdbRating: movie.tmdbRating || movie.kpRating || movie.imdbRating || null,
                kpRating: movie.kpRating || null
              })
              .onClick((item) => {
                PotokSDK.ui.showHUD("success", `Выбран фильм: ${item.title}`);
              })
          )
        );
    } else {
      searchResults = Text("По вашему запросу ничего не найдено.")
        .variant("secondary")
        .size("sm");
    }
  } else {
    searchResults = Text("Введите название фильма или сериала (например, 'начало', 'интер' или 'марс')...")
      .variant("secondary")
      .size("sm");
  }

  return Card()
    .title("3. Интерактивный поиск фильмов (SearchBar & TMDB Network Search)")
    .subtitle("Живой сетевой поиск релизов по базе данных TMDB с выдачей нативных карточек")
    .child(
      VStack()
        .spacing(16)
        .children([
          Text("Поисковая строка (SearchBar):").bold(true).variant("primary").size("sm"),
          SearchBar()
            .id("stable-search-bar-demo") // Стабильный ID гарантирует фокус при наборе
            .placeholder("Начните вводить название фильма для мгновенного сетевого поиска...")
            .value(state.searchQuery)
            .onChange((val) => {
              setSearchQuery(val);
            })
            .onClear(() => {
              setSearchQuery("");
            }),

          Divider(),

          Text("Результаты поиска TMDB (Лимит 7 карточек):").bold(true).variant("primary").size("sm"),
          searchResults
        ])
    );
}
