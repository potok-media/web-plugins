import { PotokSDK } from 'potok-sdk';
import { state, setInputValue, setToggleChecked, setSelectValue } from './state.js';
import { buildTypographyCard } from './views/typography.js';
import { buildControlsCard } from './views/controls.js';
import { buildFormsCard } from './views/forms.js';
import { buildStreamCard } from './views/stream.js';
import { buildCardsCard } from './views/cards.js';
import { buildStateMirrorCard } from './views/stateMirror.js';

const { VStack } = PotokSDK.ui.components;

function buildShowcaseLayout() {
  return VStack()
    .spacing(20)
    .children([
      buildTypographyCard(),
      buildControlsCard(),
      buildFormsCard(state, setInputValue, setToggleChecked, setSelectValue),
      buildStreamCard(),
      buildCardsCard(),
      buildStateMirrorCard(state)
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
