import { PotokSDK } from 'potok-sdk';
import { state, setInputValue, setToggleChecked, setSelectValue, setActiveCategory } from './state.js';
import { buildTypographyCard } from './views/typography.js';
import { buildControlsCard } from './views/controls.js';
import { buildFormsCard } from './views/forms.js';
import { buildStreamCard } from './views/stream.js';
import { buildCardsCard } from './views/cards.js';
import { buildStateMirrorCard } from './views/stateMirror.js';

const { VStack, HStack, Card, Button } = PotokSDK.ui.components;

function buildShowcaseLayout() {
  // Левое меню навигации категорий
  const categoriesMenu = Card()
    .title("Компоненты SDK")
    .subtitle("Выберите нужный раздел")
    .width("260px")
    .child(
      VStack()
        .spacing(8)
        .children([
          Button("1. Типографика и текст")
            .variant(state.activeCategory === 'typography' ? 'primary' : 'ghost')
            .width("100%")
            .onClick(() => setActiveCategory('typography')),
          
          Button("2. Кнопки и бейджи")
            .variant(state.activeCategory === 'controls' ? 'primary' : 'ghost')
            .width("100%")
            .onClick(() => setActiveCategory('controls')),
          
          Button("3. Управление и формы")
            .variant(state.activeCategory === 'forms' ? 'primary' : 'ghost')
            .width("100%")
            .onClick(() => setActiveCategory('forms')),
          
          Button("4. Медиа и раздачи")
            .variant(state.activeCategory === 'media' ? 'primary' : 'ghost')
            .width("100%")
            .onClick(() => setActiveCategory('media')),
          
          Button("5. Карточки (Card)")
            .variant(state.activeCategory === 'cards' ? 'primary' : 'ghost')
            .width("100%")
            .onClick(() => setActiveCategory('cards')),
          
          Button("6. Состояние плагина")
            .variant(state.activeCategory === 'state' ? 'primary' : 'ghost')
            .width("100%")
            .onClick(() => setActiveCategory('state'))
        ])
    );

  // Правая контентная область для активной категории
  let activeView;
  switch (state.activeCategory) {
    case 'typography':
      activeView = buildTypographyCard();
      break;
    case 'controls':
      activeView = buildControlsCard();
      break;
    case 'forms':
      activeView = buildFormsCard(state, setInputValue, setToggleChecked, setSelectValue);
      break;
    case 'media':
      activeView = buildStreamCard();
      break;
    case 'cards':
      activeView = buildCardsCard();
      break;
    case 'state':
      activeView = buildStateMirrorCard(state);
      break;
    default:
      activeView = buildTypographyCard();
  }

  const contentArea = VStack()
    .flex(1)
    .child(activeView);

  // Возвращаем двухколоночную разметку
  return HStack()
    .spacing(20)
    .alignItems("start")
    .children([
      categoriesMenu,
      contentArea
    ]);
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
