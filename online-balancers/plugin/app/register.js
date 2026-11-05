import { PLUGIN_ID, PAGE_ID } from '../constants.js';
import { mediaQuery, pageUrl, sanitizeTitle } from '../routing/mediaContext.js';
import { Button, PotokSDK, t } from '../ui/sdk.js';

export function registerPlugin({ controller, renderLayout, searchService, episodeService, playbackService }) {
  PotokSDK.streams.registerStreamSource({
    id: PLUGIN_ID,
    name: t('manifest.sourceName'),
    supportedTypes: ['movie', 'tv'],

    async search(query) {
      const response = await searchService.search(query);
      if (Object.keys(response.errors).length > 0) {
        console.warn('[OnlineBalancers] Some providers failed:', response.errors);
      }
      // Casting only annotates: ARM-bound sources carry workId/entryId, everything the providers
      // returned stays in the output — bound first, uncast appended after.
      return [...response.items, ...(response.unresolvedItems || [])];
    },

    getEpisodes(stream, context) {
      return episodeService.fetchEpisodes(stream, context);
    },

    getPlaybackInfo(payload) {
      return playbackService.resolvePlayback(
        payload.stream,
        payload.episode,
        payload.context,
        payload.episodes,
        payload.activeEpisodeId,
      );
    },

    refreshStreamUrl(payload) {
      return playbackService.refresh(payload);
    },
  });

  PotokSDK.registerSlotContribution({
    id: PAGE_ID,
    slotName: 'extension-page',
    render(props) {
      controller.applyRoute(props);
      return { label: t('manifest.name'), layout: renderLayout() };
    },
  });

  PotokSDK.registerSlotContribution({
    id: 'online-balancers-media-actions',
    slotName: 'media-actions',
    render(props) {
      const label = t('action.watch');
      return {
        label,
        layout: Button(label)
          .variant('watch-online')
          .icon('play')
          .onClick(() => {
            const context = mediaQuery({ ...(props?.media || {}), ...(props || {}) });
            const title = sanitizeTitle(context.title || context.originalTitle);
            if (!title) {
              PotokSDK.ui.showHUD('warning', t('action.missingTitle'));
              return;
            }
            PotokSDK.ui.navigateTo(pageUrl(title, context));
          }),
      };
    },
  });
}
