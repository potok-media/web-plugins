import { PLUGIN_ID, PAGE_ID } from '../constants.js';
import { createOnlineBalancersClient } from '../api/onlineBalancersClient.js';
import { createEpisodeService } from '../episodes/episodesController.js';
import { createPlaybackService } from '../playback/playbackController.js';
import { createSessionStore } from '../playback/sessionStore.js';
import { createSearchService } from '../search/searchController.js';
import { sourceRegistry } from '../sources/registry.js';
import { buildPage } from '../ui/page.js';
import { installStyles } from '../ui/styles.js';
import { PotokSDK, t } from '../ui/sdk.js';
import { createAppController } from './controller.js';
import { registerPlugin } from './register.js';
import { createPageState } from './state.js';
import { createAccountVault } from '../accounts/accountVault.js';

export function bootstrap({ client = createOnlineBalancersClient(), registry = sourceRegistry } = {}) {
  installStyles();
  const accountVault = createAccountVault(PotokSDK.storage.local);
  const searchService = createSearchService({
    client,
    registry,
    accountVault,
    arm: PotokSDK.arm,
    getLocale: () => PotokSDK.i18n.language,
  });
  const episodeService = createEpisodeService({ client, translate: t, accountVault, arm: PotokSDK.arm });
  const sessionStore = createSessionStore();
  const playbackService = createPlaybackService({
    client,
    episodeService,
    sessionStore,
    pluginId: PLUGIN_ID,
    translate: t,
    playVideo: payload => PotokSDK.ui.playVideo(payload),
    accountVault,
  });
  const state = createPageState();
  const controller = createAppController({
    state,
    searchService,
    episodeService,
    playbackService,
    accountVault,
    client,
    registry,
    ui: PotokSDK.ui,
    translate: t,
  });
  const renderLayout = () => buildPage({ state, actions: controller.actions, registry });
  controller.setRenderer(() => PotokSDK.ui.render(renderLayout(), PAGE_ID));
  registerPlugin({ controller, renderLayout, searchService, episodeService, playbackService });
  PotokSDK.playback?.onPlaylistItemChange?.((event) => controller.actions.syncActiveEpisode(event));
  PotokSDK.playback?.onPlaybackStopped?.(() => controller.actions.clearActiveEpisode());
  void controller.loadAccounts();
  return Object.freeze({
    client,
    registry,
    state,
    controller,
    searchService,
    episodeService,
    playbackService,
    accountVault,
  });
}
