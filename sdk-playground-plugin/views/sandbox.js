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
  EpisodeCard
} = PotokSDK.ui.components;

let monacoLoadingStarted = false;
let activeEditorComponent = null;

function ensureMonacoLoaded() {
  if (typeof window === 'undefined') return;
  if (window.monaco) {
    if (!state.isMonacoLoaded) {
      setMonacoLoaded(true);
    }
    return;
  }
  if (monacoLoadingStarted) return;
  monacoLoadingStarted = true;

  // Set a fallback timer for 2 seconds (graceful degradation)
  const fallbackTimer = setTimeout(() => {
    if (!window.monaco) {
      console.warn("[Monaco] Timeout loading Monaco from CDN. Falling back to textarea.");
      setMonacoLoaded(false);
    }
  }, 2000);

  if (typeof window.require !== 'undefined') {
    window.require(['vs/editor/editor.main'], function () {
      clearTimeout(fallbackTimer);
      setMonacoLoaded(true);
      console.log("[Monaco] Loaded successfully from CDN.");
    });
  } else {
    clearTimeout(fallbackTimer);
    setMonacoLoaded(false);
  }
}

const copyStyles = () => {
  try {
    const parentDoc = window.parent.document;
    const parentHead = parentDoc.head;
    const iframeHead = document.head;
    const styleTags = iframeHead.getElementsByTagName('style');
    for (let i = 0; i < styleTags.length; i++) {
      const style = styleTags[i];
      const content = style.innerHTML || "";
      if (content.includes('monaco') || content.includes('vs-dark') || style.getAttribute('data-name')) {
        const id = `monaco-style-${i}`;
        if (!parentHead.querySelector(`#${id}`)) {
          const clone = style.cloneNode(true);
          clone.id = id;
          parentHead.appendChild(clone);
        }
      }
    }
  } catch (e) {
    console.warn("Failed to copy Monaco styles:", e);
  }
};

function mountMonacoEditor() {
  if (typeof window === 'undefined') return;
  if (!window.monaco) return;

  let parentDoc;
  try {
    parentDoc = window.parent.document;
  } catch (e) {
    parentDoc = document;
  }

  const container = parentDoc.getElementById("monaco-editor-root");
  if (!container) {
    setTimeout(mountMonacoEditor, 50);
    return;
  }

  if (window._monacoEditor) {
    if (window._monacoEditor.getDomNode() !== container) {
      window._monacoEditor.dispose();
      window._monacoEditor = null;
    } else {
      if (activeEditorComponent !== state.sandboxSelectedComponent) {
        activeEditorComponent = state.sandboxSelectedComponent;
        window._monacoEditor.setValue(state.sandboxCustomCode);
      } else if (window._monacoEditor.getValue() !== state.sandboxCustomCode) {
        window._monacoEditor.setValue(state.sandboxCustomCode);
      }
      return;
    }
  }

  console.log("[Monaco] Initializing editor instance on", container);

  window.monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false
  });

  if (!window._monacoSdkLibAdded) {
    window.monaco.languages.typescript.javascriptDefaults.addExtraLib(`
      declare namespace PotokSDK {
        const pluginId: string;
        const permissions: string[];
        function createState<T extends object>(state: T): T;
        
        namespace ui {
          function showHUD(type: 'info' | 'success' | 'warning' | 'error', msg: string): void;
          function navigateTo(path: string): void;
          function render(layout: any, target: string): void;
          
          namespace components {
            function VStack(): VStackBuilder;
            function HStack(): HStackBuilder;
            function Grid(): GridBuilder;
            function Card(): CardBuilder;
            function Button(text: string): ButtonBuilder;
            function Text(text: string): TextBuilder;
            function Badge(text: string): BadgeBuilder;
            function Spacer(): SpacerBuilder;
            function Divider(): DividerBuilder;
            function EpisodeCard(): EpisodeCardBuilder;
            function Input(name: string): InputBuilder;
            function Toggle(name: string): ToggleBuilder;
            function Select(name: string): SelectBuilder;
            function SearchBar(name: string): SearchBarBuilder;
            function StreamFilterBar(): StreamFilterBarBuilder;
            function MediaPlayer(): MediaPlayerBuilder;
            function EpisodesSection(): EpisodesSectionBuilder;
            function EpisodeSelector(): EpisodeSelectorBuilder;
            function StreamRow(): StreamRowBuilder;
            function MediaCast(): MediaCastBuilder;
            function MediaOverview(): MediaOverviewBuilder;
            function MediaRow(): MediaRowBuilder;
            function Markdown(content: string): MarkdownBuilder;
            function LoadingSpinner(): LoadingSpinnerBuilder;
          }
        }
      }

      interface UIComponent {
        id(v: string): this;
        width(v: string | number): this;
        height(v: string | number): this;
        visible(v: boolean): this;
      }

      interface VStackBuilder extends UIComponent {
        spacing(v: number): this;
        alignItems(v: 'start' | 'center' | 'end' | 'stretch'): this;
        justifyContent(v: 'start' | 'center' | 'end' | 'between' | 'around'): this;
        children(elms: any[]): this;
        child(elm: any): this;
      }

      interface HStackBuilder extends UIComponent {
        spacing(v: number): this;
        alignItems(v: 'start' | 'center' | 'end' | 'stretch'): this;
        justifyContent(v: 'start' | 'center' | 'end' | 'between' | 'around'): this;
        children(elms: any[]): this;
        child(elm: any): this;
      }

      interface GridBuilder extends UIComponent {
        minWidth(v: string): this;
        gap(v: string): this;
        children(elms: any[]): this;
      }

      interface CardBuilder extends UIComponent {
        title(v: string): this;
        subtitle(v: string): this;
        child(elm: any): this;
      }

      interface ButtonBuilder extends UIComponent {
        variant(v: 'primary' | 'secondary' | 'ghost' | 'sidebar-item' | string): this;
        icon(v: string): this;
        disabled(v: boolean): this;
        onClick(cb: () => void): this;
      }

      interface TextBuilder extends UIComponent {
        variant(v: 'primary' | 'secondary' | 'hint' | 'error' | 'success' | 'danger' | 'ghost' | 'sidebar-item'): this;
        size(v: 'xs' | 'sm' | 'md' | 'lg'): this;
        bold(v: boolean): this;
      }

      interface BadgeBuilder extends UIComponent {
        color(v: 'info' | 'success' | 'warning' | 'error'): this;
      }

      interface DividerBuilder extends UIComponent {}
      interface SpacerBuilder extends UIComponent {}

      interface InputBuilder extends UIComponent {
        label(v: string): this;
        placeholder(v: string): this;
        inputType(v: 'text' | 'password' | 'number' | 'textarea'): this;
        value(v: string | number): this;
        disabled(v: boolean): this;
        onChange(cb: (val: string) => void): this;
      }

      interface ToggleBuilder extends UIComponent {
        label(v: string): this;
        description(v: string): this;
        value(v: boolean): this;
        disabled(v: boolean): this;
        onChange(cb: (val: boolean) => void): this;
      }

      interface SelectBuilder extends UIComponent {
        label(v: string): this;
        options(v: { value: string; label: string }[]): this;
        value(v: string): this;
        disabled(v: boolean): this;
        onChange(cb: (val: string) => void): this;
      }

      interface SearchBarBuilder extends UIComponent {
        placeholder(v: string): this;
        value(v: string): this;
        disabled(v: boolean): this;
        onChange(cb: (val: string) => void): this;
        onClear(cb: () => void): this;
      }

      interface StreamFilterBarBuilder extends UIComponent {
        countLabel(v: string): this;
        trackers(v: string[]): this;
        activeTracker(v: string): this;
        onRefresh(cb: () => void): this;
        onQualityChange(cb: (val: string) => void): this;
        onTrackerChange(cb: (val: string) => void): this;
      }

      interface MediaPlayerBuilder extends UIComponent {
        playback(v: any): this;
      }

      interface EpisodesSectionBuilder extends UIComponent {
        mediaId(v: number): this;
        numberOfSeasons(v: number): this;
        onEpisodeClick(cb: (ep: any) => void): this;
      }

      interface EpisodeSelectorBuilder extends UIComponent {
        isOpen(v: boolean): this;
        title(v: string): this;
        subtitle(v: string): this;
        backdropSrc(v: string): this;
        seasonsLoading(v: boolean): this;
        seasons(v: any[]): this;
        episodes(v: any[]): this;
        onClose(cb: () => void): this;
        onPlay(cb: (payload: any) => void): this;
      }

      interface StreamRowBuilder extends UIComponent {
        stream(v: any): this;
        onClick(cb: (stream: any) => void): this;
      }

      interface MediaCastBuilder extends UIComponent {
        cast(v: any[]): this;
      }

      interface MediaOverviewBuilder extends UIComponent {
        media(v: any): this;
      }

      interface MediaRowBuilder extends UIComponent {
        title(v: string): this;
        items(v: any[]): this;
        onCardClick(cb: (item: any) => void): this;
      }

      interface MarkdownBuilder extends UIComponent {}
      interface LoadingSpinnerBuilder extends UIComponent {
        message(v: string): this;
      }
      interface EpisodeCardBuilder extends UIComponent {
        episode(v: any): this;
        onClick(cb: (ep: any) => void): this;
      }
    `, 'ts:filename/potok-sdk.d.ts');
    window._monacoSdkLibAdded = true;
  }

  const editor = window.monaco.editor.create(container, {
    value: state.sandboxCustomCode,
    language: 'javascript',
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbers: 'on',
    scrollbar: {
      vertical: 'visible',
      horizontal: 'visible'
    }
  });

  window._monacoEditor = editor;
  activeEditorComponent = state.sandboxSelectedComponent;

  copyStyles();

  // Watch for dynamic style updates from Monaco and copy them
  const styleObserver = new MutationObserver(() => {
    copyStyles();
  });
  styleObserver.observe(document.head, { childList: true });

  let debounceTimer;
  editor.onDidChangeModelContent(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      updateSandboxCode(editor.getValue());
    }, 300);
  });
}

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
    ensureMonacoLoaded();
    if (state.isMonacoLoaded) {
      mountMonacoEditor();
    }

    try {
      const codeToEval = state.sandboxCustomCode.trim();
      let evaluator;
      if (codeToEval.includes('return ')) {
        evaluator = new Function(
          'PotokSDK',
          'VStack', 'HStack', 'Card', 'Button', 'Select', 'Text', 'Heading', 'Divider', 'Spacer', 'Markdown', 'Badge', 'Input', 'Toggle', 'LoadingSpinner', 'SearchBar', 'StreamFilterBar', 'MediaPlayer', 'EpisodesSection', 'EpisodeSelector', 'StreamRow', 'MediaCast', 'MediaOverview', 'MediaRow', 'Grid', 'EpisodeCard',
          codeToEval
        );
      } else {
        evaluator = new Function(
          'PotokSDK',
          'VStack', 'HStack', 'Card', 'Button', 'Select', 'Text', 'Heading', 'Divider', 'Spacer', 'Markdown', 'Badge', 'Input', 'Toggle', 'LoadingSpinner', 'SearchBar', 'StreamFilterBar', 'MediaPlayer', 'EpisodesSection', 'EpisodeSelector', 'StreamRow', 'MediaCast', 'MediaOverview', 'MediaRow', 'Grid', 'EpisodeCard',
          `return (${codeToEval});`
        );
      }
      liveElement = evaluator(
        PotokSDK,
        VStack, HStack, Card, Button, Select, Text, Heading, Divider, Spacer, Markdown, Badge, Input, Toggle, LoadingSpinner, SearchBar, StreamFilterBar, MediaPlayer, EpisodesSection, EpisodeSelector, StreamRow, MediaCast, MediaOverview, MediaRow, Grid, EpisodeCard
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

  // Формируем представление редактора (или фрейм Monaco, или fallback textarea)
  let codeSnippetView = null;
  if (state.showSandboxCode) {
    if (state.isMonacoLoaded) {
      codeSnippetView = VStack()
        .id("monaco-editor-root")
        .height(320);
    } else {
      codeSnippetView = Input("sandbox-fallback-textarea")
        .label("Редактор кода (оффлайн режим)")
        .inputType("textarea")
        .value(state.sandboxCustomCode)
        .onChange((val) => updateSandboxCode(val));
    }
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
