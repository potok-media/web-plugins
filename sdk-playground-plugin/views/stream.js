import { PotokSDK } from 'potok-sdk';
import { state, toggleMediaCode } from '../state.js';

const { VStack, HStack, Card, Heading, Text, Button, StreamRowComponent, MediaCard, HeroSpotlight, Divider, MediaRow, StreamFilterBar, MediaPlayer, Spacer, Markdown } = PotokSDK.ui.components;

export function buildStreamCard(state, setMediaPlayerPlayback, setActiveFilterTracker, setActiveFilterQuality) {
  // 1. Плеер (если запущен)
  let activePlayer = null;
  if (state.mediaPlayerPlayback) {
    activePlayer = MediaPlayer()
      .playback(state.mediaPlayerPlayback)
      .isNetworkOffline(false);
  }

  // 2. Демо-данные для промо-баннера фильма (HeroSpotlight)
  const spotlightBanner = HeroSpotlight()
    .items([
      {
        card: {
          id: 101,
          title: "Интерстеллар",
          subtitle: "Interstellar (2014)",
          mediaType: "movie",
          backdropSrc: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&h=500&q=80",
          overview: "Когда наше время на Земле подходит к концу, группа исследователей отправляется в самую важную экспедицию в истории человечества: путешествие за пределы нашей галактики, чтобы выяснить, есть ли у человечества будущее среди звезд.",
          imdbRating: 8.7,
          kpRating: 8.6,
          genres: "Фантастика, Драма, Приключения",
          ageRating: "12+",
          isInWatchlist: false
        }
      }
    ])
    .onPlay((item) => {
      // Запускаем видеоплеер для Интерстеллар
      setMediaPlayerPlayback({
        streamUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        title: item.card.title,
        mediaType: "movie"
      });
    })
    .onDetails((item) => {
      PotokSDK.ui.showHUD("info", `Описание фильма: ${item.card.title}`);
    });

  // 3. Демо-данные для карусели фильмов (MediaRow)
  const mediaRowCarousel = MediaRow()
    .id("playground-media-row")
    .title("Популярно сейчас")
    .items([
      {
        id: 102,
        title: "Начало",
        subtitle: "Inception (2010)",
        mediaType: "movie",
        posterSrc: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=260&h=380&q=80",
        tmdbRating: 8.8,
        kpRating: 8.7,
        progress: { percentage: 65 }
      },
      {
        id: 103,
        title: "Бегущий по лезвию 2049",
        subtitle: "Blade Runner 2049 (2017)",
        mediaType: "movie",
        posterSrc: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=260&h=380&q=80",
        tmdbRating: 8.0,
        kpRating: 7.8,
        progress: null
      }
    ])
    .onCardClick((item) => {
      // Запускаем видеоплеер для выбранной карточки
      setMediaPlayerPlayback({
        streamUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
        title: item.title,
        mediaType: "movie"
      });
    })
    .onSeeAllClick((row) => {
      PotokSDK.ui.showHUD("info", `Переход в категорию: ${row.title}`);
    });

  // 4. Панель фильтров списка раздач (StreamFilterBar)
  const filterBar = StreamFilterBar()
    .countLabel("Найдено 3 раздачи")
    .qualityFilter(state.activeFilterQuality)
    .activeTracker(state.activeFilterTracker)
    .trackers([
      { id: "all", name: "Все трекеры" },
      { id: "rutracker", name: "Rutracker" },
      { id: "rutor", name: "Rutor" }
    ])
    .showSort(true)
    .sortOption("seedersDesc")
    .onQualityChange((q) => {
      setActiveFilterQuality(q);
    })
    .onTrackerChange((t) => {
      setActiveFilterTracker(t);
    })
    .onRefresh(() => {
      PotokSDK.ui.showHUD("info", "Список раздач обновлен!");
    });

  // 5. Контейнер разметки
  const childrenList = [
    HStack()
      .spacing(8)
      .alignItems("center")
      .children([
        Heading("4. Медиа-компоненты фильмов (Spotlight Banner, Media Row, Filters & Player)").level(3),
        Spacer(),
        Button("</>").variant("ghost").onClick(() => { toggleMediaCode(); })
      ])
  ];

  if (state.showMediaCode) {
    childrenList.push(
      Markdown(
        `### 💻 Исходный код \`views/stream.js\`

\`\`\`js
${state.mediaCode || '// Загрузка исходного кода...'}
\`\`\`
`
      )
    );
    childrenList.push(Divider());
  }

  childrenList.push(
    // А. Промо-баннер фильма
    Text("Cinematic Spotlight (Промо-баннер с кнопкой запуска плеера):").bold(true).variant("primary").size("sm"),
    spotlightBanner,
    
    Divider(),

    // Б. Горизонтальная карусель релизов
    Text("Media Row (Карусель карточек релизов):").bold(true).variant("primary").size("sm"),
    mediaRowCarousel,

    Divider(),

    // В. Панель фильтрации стримов
    Text("Stream Filter Bar (Панель сортировки и фильтрации):").bold(true).variant("primary").size("sm"),
    filterBar,

    // Г. Элемент списка раздач
    Text("Torrent Stream Row (Раздача):").bold(true).variant("primary").size("sm"),
    StreamRowComponent()
      .stream({
        title: "Люди Икс: Начало. Росомаха / X-Men Origins: Wolverine (2009) BDRip 1080p | Лицензия",
        tracker: "Rutracker",
        sizeLabel: "7.9 GB",
        seeders: 245,
        leechers: 12,
        publishDate: "2026-05-15T12:00:00Z",
        tags: [
          { kind: "quality", value: "1080p" },
          { kind: "audio", value: "Дубляж" },
          { kind: "source", value: "BDRip" }
        ]
      })
      .onClick((stream) => {
        setMediaPlayerPlayback({
          streamUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
          title: stream.title,
          mediaType: "movie"
        });
      })
  );

  const mainVStack = VStack()
    .spacing(16)
    .children(childrenList);

  // Если плеер активен, добавляем его поверх всего макета
  if (activePlayer) {
    return VStack()
      .spacing(16)
      .children([
        activePlayer,
        mainVStack
      ]);
  }

  return Card()
    .subtitle("Полноценные разделы контента, каруселей, системных плееров и списков")
    .child(mainVStack);
}
