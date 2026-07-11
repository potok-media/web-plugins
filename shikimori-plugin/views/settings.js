import { PotokSDK } from 'potok-sdk';
import { state } from '../state.js';
import { clearCardMeta } from '../data/cardMeta.js';
import { loadGenres } from '../data/genres.js';
import { loadCollections } from '../data/shelves.js';
import { renderHomeContribution } from './home.js';
import {
  Card, VStack, HStack, Text, Button, t,
} from '../sdk.js';

async function resetCache() {
  await PotokSDK.storage.local.clear();
  clearCardMeta();
  state.shelves = {};
  state.genres = await loadGenres();
  await loadCollections(renderHomeContribution);
  PotokSDK.ui.showHUD('success', t('settings.cacheCleared'));
}

export function settingsLayout() {
  return Card()
    .padding([20, 22])
    .width('100%')
    .title(t('settings.title'))
    .subtitle(t('settings.subtitle'))
    .child(
      VStack().spacing(16).children([
        Text(t('settings.cacheDesc')).variant('secondary'),
        HStack().children([
          Button(t('settings.clearCache')).variant('secondary').icon('trash-2').onClick(resetCache),
        ]),
      ]),
    );
}