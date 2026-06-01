/**
 * Реестр документации и примеров кода для UI-компонентов Potok SDK.
 * Служит эталонным справочником метаданных для динамического рендеринга
 * документации и интерактивных демонстраций в песочнице.
 */
export const COMPONENT_DETAILS = {
  Button: {
    title: 'Кнопка (Button)',
    desc: 'Интерактивный элемент интерфейса для запуска действий. Поддерживает различные цветовые варианты, блокировку кликов и иконки.',
    code: 'PotokSDK.ui.components.Button("Смотреть")\n  .variant("primary")\n  .onClick(() => console.log("Клик!"))',
    illustration: null
  },
  Input: {
    title: 'Поле ввода (Input)',
    desc: 'Текстовое или числовое поле для ввода информации пользователем. Поддерживает метки (labels), плейсхолдеры и реактивное отслеживание набора.',
    code: 'PotokSDK.ui.components.Input("username")\n  .label("Имя пользователя")\n  .placeholder("Введите ник...")\n  .onChange((val) => console.log("Ввод:", val))',
    illustration: null
  },
  Toggle: {
    title: 'Переключатель (Toggle)',
    desc: 'Двухпозиционный чекбокс-переключатель (свитч) для активации/деактивации параметров.',
    code: 'PotokSDK.ui.components.Toggle("offline")\n  .label("Автономный режим")\n  .checked(true)\n  .onChange((checked) => console.log("Автономно:", checked))',
    illustration: null
  },
  Select: {
    title: 'Выпадающий список (Select)',
    desc: 'Дропдаун-меню для выбора одной опции из предопределенного списка.',
    code: 'PotokSDK.ui.components.Select("quality")\n  .label("Качество видео")\n  .options([\n    { value: "1080p", label: "Full HD (1080p)" },\n    { value: "720p", label: "HD (720p)" }\n  ])\n  .onChange((val) => console.log("Качество:", val))',
    illustration: null
  },
  Badge: {
    title: 'Бейдж (Badge)',
    desc: 'Компактная текстовая метка статуса или категории. Поддерживает различные цвета заливки.',
    code: 'PotokSDK.ui.components.Badge("Успешно")\n  .color("success")',
    illustration: null
  },
  LoadingSpinner: {
    title: 'Индикатор загрузки (LoadingSpinner)',
    desc: 'Анимированный спиннер, отображающий процесс ожидания сети. Может быть плоским или полноэкранным.',
    code: 'PotokSDK.ui.components.LoadingSpinner()\n  .message("Синхронизация раздач...")',
    illustration: null
  },
  SearchBar: {
    title: 'Поисковая строка (SearchBar)',
    desc: 'Специализированное поисковое поле с иконкой лупы и кнопкой быстрой очистки.',
    code: 'PotokSDK.ui.components.SearchBar("search")\n  .placeholder("Искать в Potok...")\n  .onChange((val) => handleSearch(val))',
    illustration: null
  },
  StreamFilterBar: {
    title: 'Панель фильтров (StreamFilterBar)',
    desc: 'Комплексная панель для сортировки и фильтрации раздач по качеству, трекерам и статусу.',
    code: 'PotokSDK.ui.components.StreamFilterBar()\n  .countLabel("Найдено: 12 раздач")\n  .trackers(["Rutor", "NNMClub"])\n  .onRefresh(() => updateList())',
    illustration: null
  },
  MediaPlayer: {
    title: 'Видеоплеер (MediaPlayer)',
    desc: 'Встроенный видеоплеер для прямого воспроизведения HLS (m3u8) или MP4 ссылок с поддержкой отслеживания сети.',
    code: 'PotokSDK.ui.components.MediaPlayer()\n  .playback({ streamUrl: "https://media.w3.org/2010/05/sintel/trailer_hd.mp4", title: "Демо-видео" })',
    illustration: null
  },
  SeasonEpisodes: {
    title: 'Сезоны и серии (SeasonEpisodes)',
    desc: 'Комплексная сетка сезонов и серий для быстрого переключения серий сериала.',
    code: 'PotokSDK.ui.components.SeasonEpisodes()\n  .numberOfSeasons(4)\n  .onEpisodeClick((ep) => play(ep))',
    illustration: null
  },
  MediaCast: {
    title: 'Актерский состав (MediaCast)',
    desc: 'Горизонтальная карусель аватарок и имен актеров/создателей медиафайла.',
    code: 'PotokSDK.ui.components.MediaCast()\n  .cast([\n    { name: "Мэттью Макконахи", role: "Купер" },\n    { name: "Энн Хэтэуэй", role: "Амелия" }\n  ])',
    illustration: null
  },
  MediaOverview: {
    title: 'Описание медиа (MediaOverview)',
    desc: 'Информационная панель с годом, рейтингом, описанием и метаданными выбранного фильма/сериала.',
    code: 'PotokSDK.ui.components.MediaOverview()\n  .media({ title: "Интерстеллар", rating: 8.6, year: 2014 })',
    illustration: null
  },
  MediaRow: {
    title: 'Карусель фильмов (MediaRow)',
    desc: 'Горизонтальная плиточная карусель медиакарточек с поддержкой кнопки перехода «Посмотреть все».',
    code: 'PotokSDK.ui.components.MediaRow()\n  .title("Популярные фильмы")\n  .items(moviesList)',
    illustration: null
  },
  EpisodeSelectorPopup: {
    title: 'Попап выбора серий (EpisodeSelectorPopup)',
    desc: 'Всплывающее модальное окно выбора серий с размытым задним бэкдропом (поповер).',
    code: 'PotokSDK.ui.components.EpisodeSelectorPopup()\n  .isOpen(true)\n  .title("Интерстеллар")\n  .backdropSrc("/backdrop.jpg")',
    illustration: null
  },
  Markdown: {
    title: 'Рендерер Markdown (Markdown)',
    desc: 'Компонент для вывода форматированного текста, списков, таблиц и PrismJS подсветки блоков кода в macOS окнах.',
    code: 'PotokSDK.ui.components.Markdown("# Заголовок\\n* Список элементов\\n* И синтаксис!")',
    illustration: null
  },
  Card: {
    title: 'Карточка (Card)',
    desc: 'Графический стеклянный блок с фоном rgba(255,255,255,0.03), рамкой и скруглениями для группировки информации.',
    code: 'PotokSDK.ui.components.Card()\n  .title("Карточка")\n  .child(PotokSDK.ui.components.Text("Контент"))',
    illustration: '```text\n+------------------------------------------------+\n| Card Container (Серый стеклянный фон)          |\n|                                                |\n|  [Заголовок карточки]                          |\n|  [Дочерние элементы...]                        |\n|                                                |\n+------------------------------------------------+\n```'
  },
  VStack: {
    title: 'Вертикальный стек (VStack)',
    desc: 'Прозрачный Flexbox-контейнер разметки. Выстраивает дочерние элементы по вертикальной оси (сверху вниз). spacing задает отступы между всеми детьми.',
    code: 'PotokSDK.ui.components.VStack()\n  .spacing(16)\n  .children([\n    PotokSDK.ui.components.Text("Сверху"),\n    PotokSDK.ui.components.Text("Снизу")\n  ])',
    illustration: '```text\n+------------------------------------------------+\n| VStack Container (Полностью прозрачный)        |\n|                                                |\n|  +------------------------------------------+  |\n|  | Дочерний элемент 1                       |  |\n|  +------------------------------------------+  |\n|  ::::::::::::::: Spacing (Отступ) ::::::::::::  |\n|  +------------------------------------------+  |\n|  | Дочерний элемент 2                       |  |\n|  +------------------------------------------+  |\n|                                                |\n+------------------------------------------------+\n```'
  },
  HStack: {
    title: 'Горизонтальный стек (HStack)',
    desc: 'Прозрачный Flexbox-контейнер разметки. Размещает дочерние элементы по горизонтальной оси (в одну строку, слева направо).',
    code: 'PotokSDK.ui.components.HStack()\n  .spacing(8)\n  .children([\n    PotokSDK.ui.components.Button("Ок"),\n    PotokSDK.ui.components.Button("Отмена")\n  ])',
    illustration: '```text\n+----------------------------------------------------------------------+\n| HStack Container (Полностью прозрачный)                              |\n|                                                                      |\n|  +-------------+  :::::::::  +-------------+  :::::::::  +---------+ |\n|  | Дочерний 1  |  | Spacing |  | Дочерний 2  |  | Spacing |  |Дочерний3| |\n|  +-------------+  :::::::::  +-------------+  :::::::::  +---------+ |\n|                                                                      |\n+----------------------------------------------------------------------+\n```'
  },
  Spacer: {
    title: 'Разделитель-распорка (Spacer)',
    desc: 'Невидимая эластичная пружина-распорка. Занимает все свободное пространство внутри VStack или HStack (flex-grow: 1), расталкивая соседние блоки по краям.',
    code: 'PotokSDK.ui.components.HStack()\n  .children([\n    PotokSDK.ui.components.Text("Логотип"),\n    PotokSDK.ui.components.Spacer(),\n    PotokSDK.ui.components.Button("Выход")\n  ])',
    illustration: '```text\n+----------------------------------------------------------------------+\n| HStack Container                                                     |\n|                                                                      |\n|  +-------------+  ===================================  +-----------+ |\n|  | Элемент слева|  <----- Эластичный Spacer() ----->  |Эл-т справа| |\n|  +-------------+  ===================================  +-----------+ |\n|                                                                      |\n+----------------------------------------------------------------------+\n```'
  },
  Divider: {
    title: 'Разделитель (Divider)',
    desc: 'Тонкая горизонтальная линия для разграничения логических блоков контента.',
    code: 'PotokSDK.ui.components.Divider()',
    illustration: '```text\n+------------------------------------------------+\n| Элемент сверху                                 |\n| ---------------------------------------------- | <-- Divider() (Линия в 1px)\n| Элемент снизу                                  |\n+------------------------------------------------+\n```'
  }
};
