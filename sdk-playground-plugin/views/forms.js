import { PotokSDK } from 'potok-sdk';

const { VStack, HStack, Card, Text, Divider, SearchBar, MediaCard, LoadingSpinner } = PotokSDK.ui.components;

export function buildFormsCard(state, setSearchQuery) {
  const query = (state.searchQuery || "").trim();

  let searchResults;

  if (state.searchLoading) {
    // Отображаем лоадер с фиксированным ID
    searchResults = LoadingSpinner()
      .id("stable-search-loading-spinner")
      .message("Выполняется поиск по базе данных TMDB...")
      .height("120px");
  } else if (query) {
    if (state.searchResults && state.searchResults.length > 0) {
      searchResults = HStack()
        .id("stable-search-results-hstack") // Стабильный ID для контейнера результатов
        .spacing(16)
        .children(
          state.searchResults.map(movie => 
            MediaCard()
              .id(`search-result-card-${movie.id}`) // Стабильный ID для карточки фильма
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
        .id("stable-search-empty-text")
        .variant("secondary")
        .size("sm");
    }
  } else {
    searchResults = Text("Введите название фильма или сериала (например, 'начало', 'интер' или 'марс')...")
      .id("stable-search-prompt-text")
      .variant("secondary")
      .size("sm");
  }

  return Card()
    .id("stable-forms-card") // Стабильный ID карточки гарантирует отсутствие пересоздания DOM родителя!
    .title("3. Интерактивный поиск фильмов (SearchBar & TMDB Network Search)")
    .subtitle("Живой сетевой поиск релизов по базе данных TMDB с выдачей нативных карточек")
    .child(
      VStack()
        .id("stable-forms-card-vstack") // Стабильный ID контейнера контента
        .spacing(16)
        .children([
          Text("Поисковая строка (SearchBar):").bold(true).variant("primary").size("sm"),
          SearchBar()
            .id("stable-search-bar-demo") // Стабильный ID строки поиска
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
