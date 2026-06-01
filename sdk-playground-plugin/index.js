import { PotokSDK } from 'potok-sdk';
import { 
  state, 
  setInputValue, 
  setToggleChecked, 
  setSelectValue, 
  setActiveCategory,
  setPopupOpen,
  setSearchQuery,
  setMediaPlayerPlayback,
  setActiveFilterTracker,
  setActiveFilterQuality,
  toggleOrchestratorCode,
  setSandboxSelectedComponent,
  toggleSandboxCode,
  initializeCodes
} from './state.js';
import { buildTypographyCard } from './views/typography.js';
import { buildControlsCard } from './views/controls.js';
import { buildFormsCard } from './views/forms.js';
import { buildStreamCard } from './views/stream.js';
import { buildCardsCard } from './views/cards.js';
import { buildPopupsCard } from './views/popups.js';
import { buildStateMirrorCard } from './views/stateMirror.js';
import { buildSandboxCard } from './views/sandbox.js';

const { VStack, HStack, Card, Button, EpisodeSelectorPopup, Spacer, Markdown } = PotokSDK.ui.components;

function buildShowcaseLayout() {
  // Горизонтальный таб-бар меню вверху страницы (занимает минимум места по вертикали)
  const tabsHeader = Card()
    .id("stable-tabs-header") // Стабильный ID шапки
    .child(
      HStack()
        .id("stable-tabs-hstack") // Стабильный ID стэка табов
        .spacing(8)
        .children([
          Button("Типографика")
            .variant(state.activeCategory === 'typography' ? 'primary' : 'ghost')
            .onClick(() => setActiveCategory('typography')),
          
          Button("Кнопки и лоадеры")
            .variant(state.activeCategory === 'controls' ? 'primary' : 'ghost')
            .onClick(() => setActiveCategory('controls')),
          
          Button("Формы и поиск")
            .variant(state.activeCategory === 'forms' ? 'primary' : 'ghost')
            .onClick(() => setActiveCategory('forms')),
          
          Button("Медиа и плеер")
            .variant(state.activeCategory === 'media' ? 'primary' : 'ghost')
            .onClick(() => setActiveCategory('media')),
          
          Button("Карточки")
            .variant(state.activeCategory === 'cards' ? 'primary' : 'ghost')
            .onClick(() => setActiveCategory('cards')),

          Button("Диалоги и поповеры")
            .variant(state.activeCategory === 'popups' ? 'primary' : 'ghost')
            .onClick(() => setActiveCategory('popups')),
          
          Button("Состояние")
            .variant(state.activeCategory === 'state' ? 'primary' : 'ghost')
            .onClick(() => setActiveCategory('state')),

          Button("Песочница")
            .variant(state.activeCategory === 'sandbox' ? 'primary' : 'ghost')
            .onClick(() => setActiveCategory('sandbox')),

          Spacer(),

          Button("</>")
            .variant(state.showOrchestratorCode ? 'primary' : 'ghost')
            .onClick(() => toggleOrchestratorCode())
        ])
    );

  // Модальный селектор эпизодов (EpisodeSelectorPopup)
  let activePopup = null;
  if (state.isPopupOpen) {
    activePopup = EpisodeSelectorPopup()
      .id("stable-episode-selector-popup") // Стабильный ID модального окна
      .isOpen(true)
      .title("Выбор озвучки и эпизода")
      .subtitle("Интерстеллар / Interstellar (2014)")
      .backdropSrc("https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&h=500&q=80")
      .seasonsLoading(false)
      .seasons([
        { seasonNumber: 1, name: "Сезон 1", episodesCount: 1 }
      ])
      .episodes([
        {
          id: "ep-1",
          season: 1,
          episode: 1,
          title: "Главная миссия человечества",
          stillPath: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=320&h=180&q=80",
          airDate: "2014-11-06"
        }
      ])
      .onClose(() => {
        setPopupOpen(false);
      })
      .onPlay((payload) => {
        setPopupOpen(false);
        // Бесшовный запуск встроенного плеера при выборе серии
        setMediaPlayerPlayback({
          streamUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
          title: `Эпизод ${payload.episode.episode}: ${payload.episode.title}`,
          mediaType: "tv"
        });
      });
  }

  // Правая контентная область для активной категории (занимает 100% ширины)
  let activeView;
  switch (state.activeCategory) {
    case 'typography':
      activeView = buildTypographyCard();
      break;
    case 'controls':
      activeView = buildControlsCard();
      break;
    case 'forms':
      activeView = buildFormsCard(state, setSearchQuery);
      break;
    case 'media':
      activeView = buildStreamCard(state, setMediaPlayerPlayback, setActiveFilterTracker, setActiveFilterQuality);
      break;
    case 'cards':
      activeView = buildCardsCard();
      break;
    case 'popups':
      activeView = buildPopupsCard(setPopupOpen);
      break;
    case 'state':
      activeView = buildStateMirrorCard(state);
      break;
    case 'sandbox':
      activeView = buildSandboxCard();
      break;
    default:
      activeView = buildTypographyCard();
  }

  let orchestratorCodeView = null;
  if (state.showOrchestratorCode) {
    const indexMd = "### index.js (Точка входа и сборка интерфейса)\n```js\n" + (state.orchestratorIndexCode || "// Загрузка кода...") + "\n```";
    const stateMd = "### state.js (Реактивное состояние и бизнес-логика)\n```js\n" + (state.orchestratorStateCode || "// Загрузка кода...") + "\n```";

    orchestratorCodeView = HStack()
      .id("stable-orchestrator-code-hstack")
      .spacing(16)
      .children([
        VStack().flex(1).children([
          Markdown(indexMd).id("orchestrator-index-md")
        ]),
        VStack().flex(1).children([
          Markdown(stateMd).id("orchestrator-state-md")
        ])
      ]);
  }

  const pageLayoutChildren = [tabsHeader];
  if (orchestratorCodeView) {
    pageLayoutChildren.push(orchestratorCodeView);
  }
  pageLayoutChildren.push(activeView);

  const pageLayout = VStack()
    .id("stable-page-layout") // Стабильный ID страницы
    .spacing(16)
    .children(pageLayoutChildren);

  // Если открыт поповер, рендерим его рядом с основным макетом
  if (activePopup) {
    return VStack()
      .id("stable-root-popup-wrapper") // Стабильный ID обертки модального окна
      .children([
        activePopup,
        pageLayout
      ]);
  }

  return pageLayout;
}

// Регистрируем вкладку в слот страниц расширений extension-page
PotokSDK.registerSlotContribution({
  id: 'potok-sdk-playground',
  slotName: 'extension-page',
  render() {
    return {
      label: 'Конструктор SDK',
      layout: buildShowcaseLayout()
    };
  }
});

// Регистрируем кнопку быстрого перехода в левом меню боковой панели (сразу после Настроек)
PotokSDK.registerSlotContribution({
  id: 'potok-sdk-playground-sidebar',
  slotName: 'sidebar-menu',
  render() {
    return {
      label: 'Конструктор SDK',
      layout: PotokSDK.ui.components.Button('Конструктор SDK')
        .variant('sidebar-item')
        .icon('terminal')
        .onClick(() => {
          PotokSDK.ui.navigateTo('/extensions/potok-sdk-playground');
        })
    };
  }
});

// Перерисовываем весь макет при изменении реактивного состояния
state.$subscribe(() => {
  PotokSDK.ui.render(buildShowcaseLayout(), 'potok-sdk-playground');
});

// Инициализируем загрузку реальных исходных кодов с сервера
initializeCodes();
