import { PotokSDK } from 'potok-sdk';
import { PAGE_ID, PAGE_PATH, HOME_ID } from './constants.js';
import { state } from './state.js';
import { t, SidebarGroup, Button } from './sdk.js';
import { applyRoute } from './navigation/routing.js';
import { buildLayout } from './views/layout.js';
import { homeRowLayout, renderHomeContribution } from './views/home.js';
import { settingsLayout } from './views/settings.js';

export function registerSlots() {
  PotokSDK.registerSlotContribution({
    id: PAGE_ID,
    slotName: 'extension-page',
    render(props) {
      applyRoute(props);
      return { label: t('manifest.name'), layout: buildLayout() };
    },
  });

  PotokSDK.registerSlotContribution({
    id: 'potok-shikimori-sidebar',
    slotName: SidebarGroup ? 'sidebar-groups' : 'sidebar-menu',
    render() {
      const catalog = Button(t('sidebar.catalog'))
        .variant('sidebar-item')
        .icon('clapperboard')
        .onClick(() => PotokSDK.ui.navigateTo(PAGE_PATH));
      const layout = SidebarGroup
        ? SidebarGroup(t('sidebar.title')).child(catalog)
        : catalog;
      return { label: t('sidebar.title'), layout };
    },
  });

  if (typeof PotokSDK.registerHomeSection === 'function') {
    PotokSDK.registerHomeSection({
      id: HOME_ID,
      position: 'top',
      render() {
        return { label: t('homeRow'), layout: homeRowLayout() };
      },
    });
  }

  PotokSDK.registerSlotContribution({
    id: 'potok-shikimori-settings',
    slotName: 'settings-tabs',
    render() {
      return { label: t('settings.title'), layout: settingsLayout() };
    },
  });
}

export function wireRendering() {
  state.$subscribe(() => {
    PotokSDK.ui.render(buildLayout(), PAGE_ID);
    renderHomeContribution();
  });
}