/**
 * Модуль Песочницы (Sandbox) для визуальной среды Potok SDK.
 * 
 * Включает в себя интеграцию живого Monaco Editor с автодополнением (IntelliSense),
 * декларативными типами SDK и компилятором на лету.
 */

import { PotokSDK } from 'potok-sdk';
import {
  state,
  setSandboxSelectedComponent,
  toggleSandboxCode,
  updateSandboxCode,
  resetSandboxCode,
  setMonacoLoaded
} from '../state.js';
import { COMPONENT_DETAILS } from '../utils/registry.js';

// Деструктурируем все необходимые компоненты из ядра Potok UI
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
  EpisodesSection,
  EpisodeSelector,
  StreamRow,
  MediaCast,
  MediaOverview,
  MediaRow,
  Grid,
  EpisodeCard,
  CodeEditor
} = PotokSDK.ui.components;



/**
 * Строит и экспортирует макет вкладки Песочницы.
 * Вызывается реактивно при изменении состояния.
 */
export function buildSandboxCard() {
  const activeType = state.sandboxSelectedComponent || 'Button';
  const meta = COMPONENT_DETAILS[activeType] || COMPONENT_DETAILS.Button;

  // Инициализируем живой экземпляр выбранного UI-компонента
  let liveElement;
  if (state.showSandboxCode) {
    try {
      const codeToEval = state.sandboxCustomCode.trim();
      let evaluator;
      if (codeToEval.includes('return ')) {
        evaluator = new Function(
          'PotokSDK',
          'VStack', 'HStack', 'Card', 'Button', 'Select', 'Text', 'Heading', 'Divider', 'Spacer', 'Markdown', 'Badge', 'Input', 'Toggle', 'LoadingSpinner', 'SearchBar', 'StreamFilterBar', 'MediaPlayer', 'EpisodesSection', 'EpisodeSelector', 'StreamRow', 'MediaCast', 'MediaOverview', 'MediaRow', 'Grid', 'EpisodeCard', 'CodeEditor',
          codeToEval
        );
      } else {
        evaluator = new Function(
          'PotokSDK',
          'VStack', 'HStack', 'Card', 'Button', 'Select', 'Text', 'Heading', 'Divider', 'Spacer', 'Markdown', 'Badge', 'Input', 'Toggle', 'LoadingSpinner', 'SearchBar', 'StreamFilterBar', 'MediaPlayer', 'EpisodesSection', 'EpisodeSelector', 'StreamRow', 'MediaCast', 'MediaOverview', 'MediaRow', 'Grid', 'EpisodeCard', 'CodeEditor',
          `return (${codeToEval});`
        );
      }
      liveElement = evaluator(
        PotokSDK,
        VStack, HStack, Card, Button, Select, Text, Heading, Divider, Spacer, Markdown, Badge, Input, Toggle, LoadingSpinner, SearchBar, StreamFilterBar, MediaPlayer, EpisodesSection, EpisodeSelector, StreamRow, MediaCast, MediaOverview, MediaRow, Grid, EpisodeCard, CodeEditor
      );
    } catch (err) {
      liveElement = Card()
        .id("sandbox-error-card")
        .child(Text("Ошибка компиляции: " + err.message).variant("error"));
    }
  } else {
    switch (activeType) {
      case 'Button':
        liveElement = Button("Нажмите на меня").variant("primary");
        break;
      case 'Input':
        liveElement = Input("sandbox-input").label("Тестовое поле ввода").placeholder("Введите текст сюда...");
        break;
      case 'Toggle':
        liveElement = Toggle("sandbox-toggle").label("Активный режим").value(true);
        break;
      case 'Select':
        liveElement = Select("sandbox-select")
          .label("Сделайте выбор")
          .options([
            { value: '1', label: 'Опция 1' },
            { value: '2', label: 'Опция 2' }
          ])
          .value("1");
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
          .playback({ streamUrl: "https://media.w3.org/2010/05/sintel/trailer_hd.mp4", title: "Тестовый плеер" });
        break;
      case 'EpisodesSection':
        liveElement = EpisodesSection().mediaId(1399).numberOfSeasons(3);
        break;
      case 'MediaCast':
        liveElement = MediaCast().cast([
          { name: "Купер", role: "Пилот" },
          { name: "Бранд", role: "Биолог" }
        ]);
        break;
      case 'MediaOverview':
        liveElement = MediaOverview().media({
          originalTitle: "Interstellar / Интерстеллар (2014)",
          genres: "Фантастика, Драма, Приключения",
          ageRating: "12+",
          numberOfSeasons: 1,
          overview: "Захватывающее космическое путешествие группы исследователей через кротовую нору...",
          imdbRating: 8.6,
          kpRating: 8.6
        });
        break;
      case 'MediaRow':
        liveElement = MediaRow().title("Горизонтальный ряд фильмов").items([
          { id: "row-item-1", title: "Интерстеллар", mediaType: "movie", posterSrc: "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=200", tmdbRating: 8.6 },
          { id: "row-item-2", title: "Марсианин", mediaType: "movie", posterSrc: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=200", tmdbRating: 8.0 }
        ]);
        break;
      case 'EpisodeSelector':
        liveElement = Button("Показать попап").onClick(() => {
          PotokSDK.ui.showHUD('info', 'В реальном плагине вызовет открытие EpisodeSelector!');
        });
        break;
      case 'StreamRow':
        liveElement = StreamRow()
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
            PotokSDK.ui.showHUD('info', `Клик по раздаче: ${stream.title}`);
          });
        break;
      case 'Markdown':
        liveElement = Markdown("### Привет из Markdown!\n* Поддержка списков\n* Жирный **текст**\n* И разметка!");
        break;
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
      case 'Grid':
        liveElement = Grid()
          .minWidth("140px")
          .gap("10px")
          .children([
            Card().title("Карточка 1").child(Text("Содержимое 1")),
            Card().title("Карточка 2").child(Text("Содержимое 2")),
            Card().title("Карточка 3").child(Text("Содержимое 3")),
            Card().title("Карточка 4").child(Text("Содержимое 4"))
          ]);
        break;
      case 'EpisodeCard':
        liveElement = EpisodeCard()
          .episode({
            id: "mock-episode-1",
            episodeNumber: 5,
            name: "Mock Episode Name",
            stillPath: "https://images.unsplash.com/photo-1598899134739-24c46f58b8c0?auto=format&fit=crop&w=280&h=157",
            overview: "Это краткое описание тестового эпизода, созданного для демонстрации компонента EpisodeCard в песочнице Potok SDK."
          })
          .onClick((ep) => {
            PotokSDK.ui.showHUD('info', `Клик по серии ${ep.episodeNumber}: ${ep.name}`);
          });
        break;
      default:
        liveElement = Text("Неизвестный компонент");
    }
  }

  // Подготавливаем текст описания из реестра
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

  // Формируем список вариантов для Select переключателя
  const selectOptions = Object.keys(COMPONENT_DETAILS).map(key => ({
    value: key,
    label: COMPONENT_DETAILS[key].title
  }));

  // Формируем представление редактора через нативный CodeEditor
  let codeSnippetView = null;
  if (state.showSandboxCode) {
    codeSnippetView = CodeEditor("sandbox-editor")
      .value(state.sandboxCustomCode)
      .onChange((val) => updateSandboxCode(val));
  }

  // Возвращаем итоговую разметку
  return VStack()
    .id("sandbox-root-layout")
    .spacing(20)
    .children([
      // Тулбар управления
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
                .value(activeType)
                .onChange((val) => setSandboxSelectedComponent(val)),
              Spacer(),
              state.showSandboxCode && Button("Сбросить")
                .variant("ghost")
                .onClick(() => resetSandboxCode()),
              Button("</>")
                .variant(state.showSandboxCode ? 'primary' : 'ghost')
                .onClick(() => toggleSandboxCode())
            ].filter(Boolean))
        ),

      // Блок кода (Monaco или Fallback)
      codeSnippetView,

      // Свободная чистая зона рендеринга
      VStack()
        .id("sandbox-free-zone")
        .spacing(10)
        .alignItems("start")
        .children([
          liveElement
        ]),

      Divider(),

      // Блок документации и схем внизу страницы
      Card()
        .id("sandbox-documentation-card")
        .child(
          Markdown(descriptionContent.join('\n'))
            .id("sandbox-markdown-description")
        )
    ].filter(Boolean));
}
