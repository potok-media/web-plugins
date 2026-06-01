import { PotokSDK } from 'potok-sdk';
import { toggleFormsCode } from '../state.js';

const { VStack, HStack, Card, Heading, Text, Divider, SearchBar, MediaCard, LoadingSpinner, Spacer, Button, Markdown } = PotokSDK.ui.components;

export function buildFormsCard(state, setSearchQuery) {
  const query = (state.searchQuery || "").trim();

  let searchResults;

  if (state.searchLoading) {
    searchResults = LoadingSpinner()
      .id("stable-search-loading-spinner")
      .message("Выполняется поиск по базе данных TMDB...")
      .height("120px");
  } else if (query) {
    if (state.searchResults && state.searchResults.length > 0) {
      searchResults = HStack()
        .id("stable-search-results-hstack")
        .spacing(16)
        .children(
          state.searchResults.map(movie => 
            MediaCard()
              .id(`search-result-card-${movie.id}`)
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

  const childrenList = [
    HStack()
      .id("stable-forms-card-header-hstack")
      .spacing(8)
      .alignItems("center")
      .children([
        Heading("3. Интерактивный поиск фильмов (SearchBar & TMDB Network Search)").level(3),
        Spacer(),
        Button("</>").variant("ghost").onClick(() => { toggleFormsCode(); })
      ])
  ];

  if (state.showFormsCode) {
    childrenList.push(
      Markdown(
        `### 💻 Исходный код \`views/forms.js\`

\`\`\`js
${state.formsCode || '// Загрузка исходного кода...'}
\`\`\`
`
      )
    );
    childrenList.push(Divider());
  }

  childrenList.push(
    Text("Поисковая строка (SearchBar):").bold(true).variant("primary").size("sm"),
    SearchBar()
      .id("stable-search-bar-demo")
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
  );

  return Card()
    .id("stable-forms-card")
    .subtitle("Живой сетевой поиск релизов по базе данных TMDB с выдачей нативных карточек")
    .child(
      VStack()
        .id("stable-forms-card-vstack")
        .spacing(16)
        .children(childrenList)
    );
}
