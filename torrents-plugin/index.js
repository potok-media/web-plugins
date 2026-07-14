import { PotokSDK } from 'potok-sdk';
import './i18n.js';
import { registerSidebarStatus } from './utils/status.js';
import { search } from './data/search.js';
import { getEpisodes } from './data/episodes.js';
import { getSeasonsMetadata, saveSeasonOverride, clearSeasonOverride, saveFileOverride, clearFileOverride } from './data/overrides.js';
import { getPlaybackInfo, getPlaybackMetadata } from './data/playback.js';

// Torrent stream source: search → episodes → playback, plus per-season override editing. Pure data provider —
// the streams/episodes UI is native. Network/look-up logic lives in ./data, pure helpers in ./utils.
PotokSDK.streams.registerStreamSource({
  id: "potok-torrents",
  name: PotokSDK.i18n.t("potok-torrents:manifest.name"),
  supportedTypes: ["movie", "tv"],
  search,
  getEpisodes,
  getSeasonsMetadata,
  saveSeasonOverride,
  clearSeasonOverride,
  saveFileOverride,
  clearFileOverride,
  getPlaybackInfo,
  getPlaybackMetadata,
});

// Sidebar status service (SearchEngine / TorrentGo health).
registerSidebarStatus();

// "Watch" button on the media details page → the native torrents watch route.
PotokSDK.registerSlotContribution({
  id: "torrents-media-actions",
  slotName: "media-actions",
  render(props) {
    const watchText = PotokSDK.i18n.t("potok-torrents:manifest.watch");
    return {
      label: watchText,
      layout: PotokSDK.ui.components.Button(watchText)
        .variant("watch-primary")
        .onClick(() => {
          PotokSDK.ui.navigateTo(`/media/${props.mediaType}/${props.mediaId}/watch/potok-torrents`, {
            media: props.media,
            season: props.season,
            episode: props.episode
          });
        })
    };
  }
});
