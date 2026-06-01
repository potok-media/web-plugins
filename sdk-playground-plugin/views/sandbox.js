/**
 * Модуль Песочницы (Sandbox) для визуальной среды Potok SDK.
 * 
 * Данный файл является эталонным примером чистой и модульной верстки плагина:
 * 1. Компоненты разметки (VStack, HStack, Spacer) используются для организации потока элементов.
 * 2. Для демонстрации «голого» рендеринга элементы помещаются прямо на фоновый слой страницы без рамок Card().
 * 3. Логика метаданных и документации полностью вынесена во вспомогательный реестр utils/registry.js.
 */

import { PotokSDK } from 'potok-sdk';
import { state, setSandboxSelectedComponent, toggleSandboxCode } from '../state.js';
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
  SeasonEpisodes,
  MediaCast,
  MediaOverview,
  MediaRow
} = PotokSDK.ui.components;

/**
 * Строит и экспортирует макет вкладки Песочницы.
 * Вызывается реактивно из главного оркестратора index.js при смене вкладок.
 */
export function buildSandboxCard() {
  const activeType = state.sandboxSelectedComponent || 'Button';
  const meta = COMPONENT_DETAILS[activeType] || COMPONENT_DETAILS.Button;

  // Инициализируем живой экземпляр выбранного UI-компонента
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
        ])
        .selected("1");
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
    case 'SeasonEpisodes':
      liveElement = SeasonEpisodes().mediaId(1399).numberOfSeasons(3); // Запрос реальных сезонов Игры Престолов (ID: 1399)
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
    case 'EpisodeSelectorPopup':
      liveElement = Button("Показать попап").onClick(() => {
        PotokSDK.ui.showHUD('info', 'В реальном плагине вызовет открытие EpisodeSelectorPopup!');
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
    default:
      liveElement = Text("Неизвестный компонент");
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

  // Если флаг активен, выводим блок с примером JS кода
  let codeSnippetView = null;
  if (state.showSandboxCode) {
    codeSnippetView = Markdown("### Пример использования в JavaScript\n```javascript\n" + meta.code + "\n```");
  }

  // Возвращаем итоговую разметку
  return VStack()
    .id("sandbox-root-layout")
    .spacing(20)
    .children([
      // Тулбар управления (внутри Card для логической зоны настроек)
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

      // Блок кода примера (если открыт)
      codeSnippetView,

      // Свободная чистая зона рендеринга (без Card, абсолютно прозрачная, прямо на фоне!)
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
