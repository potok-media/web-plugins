/**
 * Реестр документации и примеров кода для UI-компонентов Potok SDK.
 * Служит эталонным справочником метаданных для динамического рендеринга
 * документации и интерактивных демонстраций в песочнице.
 */
export const COMPONENT_DETAILS = {
  Button: {
    title: 'Кнопка (Button)',
    desc: 'Интерактивный элемент интерфейса для запуска действий. Поддерживает различные цветовые варианты, блокировку кликов и иконки.',
    code: 'PotokSDK.ui.components.Button("Нажмите на меня")\n  .variant("primary")',
    illustration: null
  },
  Input: {
    title: 'Поле ввода (Input)',
    desc: 'Текстовое или числовое поле для ввода информации пользователем. Поддерживает метки (labels), плейсхолдеры и реактивное отслеживание набора.',
    code: 'PotokSDK.ui.components.Input("sandbox-input")\n  .label("Тестовое поле ввода")\n  .placeholder("Введите текст сюда...")',
    illustration: null
  },
  Toggle: {
    title: 'Переключатель (Toggle)',
    desc: 'Двухпозиционный чекбокс-переключатель (свитч) для активации/деактивации параметров.',
    code: 'PotokSDK.ui.components.Toggle("sandbox-toggle")\n  .label("Активный режим")\n  .value(true)',
    illustration: null
  },
  Select: {
    title: 'Выпадающий список (Select)',
    desc: 'Дропдаун-меню для выбора одной опции из предопределенного списка.',
    code: 'PotokSDK.ui.components.Select("sandbox-select")\n  .label("Сделайте выбор")\n  .options([\n    { value: "1", label: "Опция 1" },\n    { value: "2", label: "Опция 2" }\n  ])\n  .value("1")',
    illustration: null
  },
  Badge: {
    title: 'Бейдж (Badge)',
    desc: 'Компактная текстовая метка статуса или категории. Поддерживает различные цвета заливки.',
    code: 'PotokSDK.ui.components.Badge("VIP Статус")\n  .color("warning")',
    illustration: null
  },
  StatusRow: {
    title: 'Строка статуса (StatusRow)',
    desc: 'Информационная строка для отображения статуса внешнего сервиса или пинга. Обычно выводится в подвале боковой панели (сайдбара).',
    code: 'PotokSDK.ui.components.StatusRow("Песочница API")\n  .status("success")\n  .value("12 ms")',
    illustration: '```text\n+------------------------------------------------+\n| StatusRow (Элемент статуса)                    |\n|  (o) Песочница API                      12 ms  |\n|   ^       ^                               ^    |\n|  Dot    Label                           Value  |\n+------------------------------------------------+\n```'
  },
  LoadingSpinner: {
    title: 'Индикатор загрузки (LoadingSpinner)',
    desc: 'Анимированный спиннер, отображающий процесс ожидания сети. Может быть плоским или полноэкранным.',
    code: 'PotokSDK.ui.components.LoadingSpinner()\n  .message("Идет рендеринг в песочнице...")',
    illustration: null
  },
  SearchBar: {
    title: 'Поисковая строка (SearchBar)',
    desc: 'Специализированное поисковое поле с иконкой лупы и кнопкой быстрой очистки.',
    code: 'PotokSDK.ui.components.SearchBar("sandbox-search")\n  .placeholder("Быстрый поиск по элементам...")',
    illustration: null
  },
  StreamFilterBar: {
    title: 'Панель фильтров (StreamFilterBar)',
    desc: 'Комплексная панель для сортировки и фильтрации раздач по качеству, трекерам и статусу.',
    code: 'PotokSDK.ui.components.StreamFilterBar()\n  .countLabel("Стенд: 5 стримов найдено")\n  .trackers(["RUTOR", "Kinozal"])\n  .activeTracker("RUTOR")',
    illustration: null
  },
  StreamRow: {
    title: 'Строка раздачи (StreamRow)',
    desc: 'Элемент списка раздач с информацией о качестве, трекере, размере, сидах/личах и дате публикации.',
    code: 'PotokSDK.ui.components.StreamRow()\n  .stream({\n    title: "Люди Икс: Начало. Росомаха / X-Men Origins: Wolverine (2009) BDRip 1080p | Лицензия",\n    tracker: "Rutracker",\n    sizeLabel: "7.9 GB",\n    seeders: 245,\n    leechers: 12,\n    publishDate: "2026-05-15T12:00:00Z",\n    tags: [\n      { kind: "quality", value: "1080p" },\n      { kind: "audio", value: "Дубляж" },\n      { kind: "source", value: "BDRip" }\n    ]\n  })\n  .onClick((stream) => {\n    PotokSDK.ui.showHUD("info", "Клик по раздаче: " + stream.title);\n  })',
    illustration: null
  },
  MediaPlayer: {
    title: 'Видеоплеер (MediaPlayer)',
    desc: 'Встроенный видеоплеер для прямого воспроизведения HLS (m3u8) или MP4 ссылок с поддержкой отслеживания сети.',
    code: 'PotokSDK.ui.components.MediaPlayer()\n  .playback({\n    streamUrl: "https://media.w3.org/2010/05/sintel/trailer_hd.mp4",\n    title: "Тестовый плеер"\n  })',
    illustration: null
  },
  EpisodesSection: {
    title: 'Сезоны и серии (EpisodesSection)',
    desc: 'Комплексная сетка сезонов и серий для быстрого переключения серий сериала.',
    code: 'PotokSDK.ui.components.EpisodesSection()\n  .mediaId(1399)\n  .numberOfSeasons(3)',
    illustration: null
  },
  MediaCast: {
    title: 'Актерский состав (MediaCast)',
    desc: 'Горизонтальная карусель аватарок и имен актеров/создателей медиафайла.',
    code: 'PotokSDK.ui.components.MediaCast()\n  .cast([\n    { name: "Купер", role: "Пилот" },\n    { name: "Бранд", role: "Биолог" }\n  ])',
    illustration: null
  },
  MediaOverview: {
    title: 'Описание медиа (MediaOverview)',
    desc: 'Информационная панель с годом, рейтингом, описанием и метаданными выбранного фильма/сериала.',
    code: 'PotokSDK.ui.components.MediaOverview()\n  .media({\n    originalTitle: "Interstellar / Интерстеллар (2014)",\n    genres: "Фантастика, Драма, Приключения",\n    ageRating: "12+",\n    numberOfSeasons: 1,\n    overview: "Захватывающее космическое путешествие группы исследователей через кротовую нору...",\n    imdbRating: 8.6,\n    kpRating: 8.6\n  })',
    illustration: null
  },
  MediaRow: {
    title: 'Карусель фильмов (MediaRow)',
    desc: 'Горизонтальная плиточная карусель медиакарточек с поддержкой кнопки перехода «Посмотреть все».',
    code: 'PotokSDK.ui.components.MediaRow()\n  .title("Горизонтальный ряд фильмов")\n  .items([\n    { id: "row-item-1", title: "Интерстеллар", mediaType: "movie", posterSrc: "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=200", tmdbRating: 8.6 },\n    { id: "row-item-2", title: "Марсианин", mediaType: "movie", posterSrc: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=200", tmdbRating: 8.0 }\n  ])',
    illustration: null
  },
  EpisodeSelector: {
    title: 'Попап выбора серий (EpisodeSelector)',
    desc: 'Всплывающее модальное окно выбора серий с размытым задним бэкдропом (поповер).',
    code: 'PotokSDK.ui.components.Button("Показать попап")\n  .onClick(() => {\n    // В реальном плагине это действие вызовет открытие EpisodeSelector\n    PotokSDK.ui.showHUD("info", "Открытие попапа!");\n  })',
    illustration: null
  },
  Markdown: {
    title: 'Рендерер Markdown (Markdown)',
    desc: 'Компонент для вывода форматированного текста, списков, таблиц и PrismJS подсветки блоков кода в macOS окнах.',
    code: 'PotokSDK.ui.components.Markdown("### Привет из Markdown!\\n* Поддержка списков\\n* Жирный **текст**\\n* И разметка!")',
    illustration: null
  },
  Card: {
    title: 'Карточка (Card)',
    desc: 'Графический стеклянный блок с фоном rgba(255,255,255,0.03), рамкой и скруглениями для группировки информации.',
    code: 'PotokSDK.ui.components.Card()\n  .title("Карточка")\n  .child(PotokSDK.ui.components.Text("Внутри карточки"))',
    illustration: '```text\n+------------------------------------------------+\n| Card Container (Серый стеклянный фон)          |\n|                                                |\n|  [Заголовок карточки]                          |\n|  [Дочерние элементы...]                        |\n|                                                |\n+------------------------------------------------+\n```'
  },
  VStack: {
    title: 'Вертикальный стек (VStack)',
    desc: 'Прозрачный Flexbox-контейнер разметки. Выстраивает дочерние элементы по вертикальной оси (сверху вниз). spacing задает отступы между всеми детьми.',
    code: 'PotokSDK.ui.components.VStack()\n  .spacing(8)\n  .children([\n    PotokSDK.ui.components.Badge("1. Элемент в стеке").color("info"),\n    PotokSDK.ui.components.Badge("2. Элемент в стеке").color("success")\n  ])',
    illustration: '```text\n+------------------------------------------------+\n| VStack Container (Полностью прозрачный)        |\n|                                                |\n|  +------------------------------------------+  |\n|  | Дочерний элемент 1                       |  |\n|  +------------------------------------------+  |\n|  ::::::::::::::: Spacing (Отступ) ::::::::::::  |\n|  +------------------------------------------+  |\n|  | Дочерний элемент 2                       |  |\n|  +------------------------------------------+  |\n|                                                |\n+------------------------------------------------+\n+------------------------------------------------+\n```'
  },
  HStack: {
    title: 'Горизонтальный стек (HStack)',
    desc: 'Прозрачный Flexbox-контейнер разметки. Размещает дочерние элементы по горизонтальной оси (в одну строку, слева направо).',
    code: 'PotokSDK.ui.components.HStack()\n  .spacing(8)\n  .children([\n    PotokSDK.ui.components.Badge("Лево").color("info"),\n    PotokSDK.ui.components.Badge("Право").color("success")\n  ])',
    illustration: '```text\n+----------------------------------------------------------------------+\n| HStack Container (Полностью прозрачный)                              |\n|                                                                      |\n|  +-------------+  :::::::::  +-------------+  :::::::::  +---------+ |\n|  | Дочерний 1  |  | Spacing |  | Дочерний 2  |  | Spacing |  |Дочерний3| |\n|  +-------------+  :::::::::  +-------------+  :::::::::  +---------+ |\n|                                                                      |\n+----------------------------------------------------------------------+\n```'
  },
  Spacer: {
    title: 'Разделитель-распорка (Spacer)',
    desc: 'Невидимая эластичная пружина-распорка. Занимает все свободное пространство внутри VStack или HStack (flex-grow: 1), расталкивая соседние блоки по краям.',
    code: 'PotokSDK.ui.components.HStack()\n  .children([\n    PotokSDK.ui.components.Badge("Слева").color("info"),\n    PotokSDK.ui.components.Spacer(),\n    PotokSDK.ui.components.Badge("Справа").color("success")\n  ])',
    illustration: '```text\n+----------------------------------------------------------------------+\n| HStack Container                                                     |\n|                                                                      |\n|  +-------------+  ===================================  +-----------+ |\n|  | Элемент слева|  <----- Эластичный Spacer() ----->  |Эл-т справа| |\n|  +-------------+  ===================================  +-----------+ |\n|                                                                      |\n+----------------------------------------------------------------------+\n```'
  },
  Divider: {
    title: 'Разделитель (Divider)',
    desc: 'Тонкая горизонтальная линия для разграничения логических блоков контента.',
    code: 'PotokSDK.ui.components.VStack()\n  .spacing(8)\n  .children([\n    PotokSDK.ui.components.Text("Выше разделителя"),\n    PotokSDK.ui.components.Divider(),\n    PotokSDK.ui.components.Text("Ниже разделителя")\n  ])',
    illustration: '```text\n+------------------------------------------------+\n| Элемент сверху                                 |\n| ---------------------------------------------- | <-- Divider() (Линия в 1px)\n| Элемент снизу                                  |\n+------------------------------------------------+\n```'
  },
  Grid: {
    title: 'Сетка (Grid)',
    desc: 'Адаптивный Grid-контейнер разметки. Выстраивает дочерние элементы в виде сетки с автоматическим расчетом колонок на основе минимальной ширины ячеек (minWidth) и зазора (gap).',
    code: 'PotokSDK.ui.components.Grid()\n  .minWidth("140px")\n  .gap("10px")\n  .children([\n    PotokSDK.ui.components.Card().title("Карточка 1").child(PotokSDK.ui.components.Text("Содержимое 1")),\n    PotokSDK.ui.components.Card().title("Карточка 2").child(PotokSDK.ui.components.Text("Содержимое 2"))\n  ])',
    illustration: '```text\n+------------------------------------------------+\n| Grid Container (Сетка колонок)                 |\n|                                                |\n|  +-------------+  gap  +-------------+         |\n|  | Ячейка 1    | <---> | Ячейка 2    |         |\n|  | (minWidth)  |       | (minWidth)  |         |\n|  +-------------+       +-------------+         |\n|                                                |\n+------------------------------------------------+\n```'
  },
  EpisodeCard: {
    title: 'Карточка эпизода (EpisodeCard)',
    desc: 'Интерактивная карточка серии с превью-изображением (stillPath), номером и описанием серии. Использует глобальные стили медиа-контента Potok.',
    code: 'PotokSDK.ui.components.EpisodeCard()\n  .episode({\n    id: "episode-1",\n    episodeNumber: 5,\n    name: "Имя серии",\n    stillPath: "https://images.unsplash.com/photo-1598899134739-24c46f58b8c0?auto=format&fit=crop&w=280&h=157",\n    overview: "Описание серии..."\n  })\n  .onClick((ep) => {\n    PotokSDK.ui.showHUD("info", "Нажали на серию: " + ep.name);\n  })',
    illustration: '```text\n+------------------------------------------------+\n| EpisodeCard Container                          |\n|  +------------------------------------------+  |\n|  | [ Изображение серии (stillPath) ]        |  |\n|  +------------------------------------------+  |\n|  | Серия 5: Имя серии                       |  |\n|  | Описание серии...                        |  |\n|  +------------------------------------------+  |\n+------------------------------------------------+\n```'
  }
};
