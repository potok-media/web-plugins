import { PotokSDK } from 'potok-sdk';
import { state, setSandboxSelectedComponent, toggleSandboxCode } from '../state.js';

const {
  VStack,
  HStack,
  Card,
  Button,
  Select,
  Text,
  Heading,
  Divider,
  Spacer,
  Markdown,
  Badge,
  Input,
  Toggle,
  LoadingSpinner,
  SearchBar,
  StreamFilterBar,
  MediaPlayer,
  SeasonEpisodes,
  MediaCast,
  MediaOverview,
  MediaRow
} = PotokSDK.ui.components;

const COMPONENT_DETAILS = {
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
    code: 'PotokSDK.ui.components.MediaPlayer()\n  .playback({ streamUrl: "https://example.com/movie.mp4", title: "Демо-видео" })',
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

export function buildSandboxCard() {
  const activeType = state.sandboxSelectedComponent || 'Button';
  const meta = COMPONENT_DETAILS[activeType] || COMPONENT_DETAILS.Button;

  // Создаем живой компонент для рендеринга
  let liveElement;
  switch (activeType) {
    case 'Button':
      liveElement = Button("Нажмите на меня").variant("primary");
      break;
    case 'Input':
      liveElement = Input("sandbox-input").label("Тестовое поле ввода").placeholder("Введите текст сюда...");
      break;
    case 'Toggle':
      liveElement = Toggle("sandbox-toggle").label("Активный режим").checked(true);
      break;
    case 'Select':
      liveElement = Select("sandbox-select")
        .label("Сделайте выбор")
        .options([
          { value: '1', label: 'Опция 1' },
          { value: '2', label: 'Опция 2' }
        ]);
      break;
    case 'Badge':
      liveElement = Badge("VIP Статус").color("warning");
      break;
    case 'LoadingSpinner':
      liveElement = LoadingSpinner().message("Идет рендеринг в песочнице...");
      break;
    case 'SearchBar':
      liveElement = SearchBar("sandbox-search").placeholder("Быстрый поиск по элементам...");
      break;
    case 'StreamFilterBar':
      liveElement = StreamFilterBar()
        .countLabel("Стенд: 5 стримов найдено")
        .trackers(["RUTOR", "Kinozal"])
        .activeTracker("RUTOR");
      break;
    case 'MediaPlayer':
      liveElement = MediaPlayer()
        .playback({ streamUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4", title: "Тестовый плеер" });
      break;
    case 'SeasonEpisodes':
      liveElement = SeasonEpisodes().mediaId(1).numberOfSeasons(3);
      break;
    case 'MediaCast':
      liveElement = MediaCast().cast([
        { name: "Купер", role: "Пилот" },
        { name: "Бранд", role: "Биолог" }
      ]);
      break;
    case 'MediaOverview':
      liveElement = MediaOverview().media({ title: "Тестовое медиа", rating: 9.0, year: 2026, summary: "Это детальный обзор выбранного контента..." });
      break;
    case 'MediaRow':
      liveElement = MediaRow().title("Горизонтальный ряд фильмов").items([
        { id: 1, title: "Фильм 1", posterPath: "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=200" },
        { id: 2, title: "Фильм 2", posterPath: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=200" }
      ]);
      break;
    case 'EpisodeSelectorPopup':
      // Не рендерим попап прямо во флэт листе, показываем кнопку открытия
      liveElement = Button("Показать попап").onClick(() => {
        PotokSDK.ui.showHUD('info', 'В реальном плагине вызовет открытие EpisodeSelectorPopup!');
      });
      break;
    case 'Markdown':
      liveElement = Markdown("### Привет из Markdown!\n* Поддержка списков\n* Жирный **текст**\n* И разметка!");
      break;
    // Разметка/Невидимые компоненты рендерятся схематично
    case 'Card':
      liveElement = Card().title("Карточка").child(Text("Внутри карточки"));
      break;
    case 'VStack':
      liveElement = VStack().spacing(8).children([
        Badge("1. Элемент в стеке").color("info"),
        Badge("2. Элемент в стеке").color("success")
      ]);
      break;
    case 'HStack':
      liveElement = HStack().spacing(8).children([
        Badge("Лево").color("info"),
        Badge("Право").color("success")
      ]);
      break;
    case 'Spacer':
      liveElement = HStack().children([
        Badge("Слева").color("info"),
        Spacer(),
        Badge("Справа").color("success")
      ]);
      break;
    case 'Divider':
      liveElement = VStack().spacing(8).children([
        Text("Выше разделителя"),
        Divider(),
        Text("Ниже разделителя")
      ]);
      break;
    default:
      liveElement = Text("Неизвестный компонент");
  }

  // Строим блок описания/документации
  const descriptionContent = [
    `## ${meta.title}`,
    `> **Назначение:** ${meta.desc}`,
    ''
  ];

  if (meta.illustration) {
    descriptionContent.push("### Визуальное устройство компонента:");
    descriptionContent.push(meta.illustration);
    descriptionContent.push('');
  }

  const selectOptions = Object.keys(COMPONENT_DETAILS).map(key => ({
    value: key,
    label: COMPONENT_DETAILS[key].title
  }));

  // Панель кода
  let codeSnippetView = null;
  if (state.showSandboxCode) {
    codeSnippetView = Markdown("### Пример использования в JavaScript\n```javascript\n" + meta.code + "\n```");
  }

  return VStack()
    .id("sandbox-root-layout")
    .spacing(20)
    .children([
      // Шапка выбора компонента
      Card()
        .id("sandbox-controls-card")
        .child(
          HStack()
            .spacing(16)
            .children([
              Text("Выберите компонент для изучения:").variant("mute"),
              Select()
                .id("sandbox-component-select")
                .options(selectOptions)
                .selected(activeType)
                .onChange((val) => setSandboxSelectedComponent(val)),
              Spacer(),
              Button("</>")
                .variant(state.showSandboxCode ? 'primary' : 'ghost')
                .onClick(() => toggleSandboxCode())
            ])
        ),

      // Код примера
      codeSnippetView,

      // Свободный чистый стенд рендеринга (без Card, чисто на бэкграунде страницы!)
      VStack()
        .id("sandbox-free-zone")
        .spacing(10)
        .alignItems("start")
        .children([
          liveElement
        ]),

      Divider(),

      // Документация под компонентом (в Card для аккуратности)
      Card()
        .id("sandbox-documentation-card")
        .child(
          Markdown(descriptionContent.join('\n'))
            .id("sandbox-markdown-description")
        )
    ].filter(Boolean));
}
