import { PotokSDK } from 'potok-sdk';
import { state } from './state.js';
import { buildControls } from './views/controls.js';
import { buildPreview } from './views/preview.js';
import { buildCodeView } from './views/codeView.js';

const { VStack, HStack } = PotokSDK.ui.components;

function buildMainLayout() {
  const left = buildControls().width(320);
  const right = VStack()
    .flex(1)
    .spacing(20)
    .children([
      buildPreview(),
      buildCodeView()
    ]);

  return HStack()
    .spacing(20)
    .children([
      left,
      right
    ]);
}

// Register slot contribution for settings-tabs
PotokSDK.registerSlotContribution({
  id: 'potok-sdk-playground',
  slotName: 'settings-tabs',
  render() {
    return {
      label: 'Конструктор SDK',
      layout: buildMainLayout()
    };
  }
});

// Register slot contribution for sidebar-status (to add button to left menu footer natively)
PotokSDK.registerSlotContribution({
  id: 'potok-sdk-playground-sidebar',
  slotName: 'sidebar-status',
  render() {
    return {
      label: 'Конструктор SDK',
      layout: PotokSDK.ui.components.Button('Конструктор SDK')
        .variant('secondary')
        .width('100%')
        .onClick(() => {
          PotokSDK.ui.navigateTo('/settings');
          PotokSDK.ui.showHUD('info', 'Конструктор SDK доступен во вкладке "Конструктор SDK" в Настройках ⚙️');
        })
    };
  }
});

// Re-render layout on reactive state changes
state.$subscribe(() => {
  PotokSDK.ui.render(buildMainLayout(), 'potok-sdk-playground');
});
