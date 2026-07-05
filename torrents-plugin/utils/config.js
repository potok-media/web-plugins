import { PotokSDK } from 'potok-sdk';

// Single source of truth for the TorrentGo base URL. Was copy-pasted verbatim in getEpisodes,
// getPlaybackInfo and status.js; deduped here. Prefers an explicitly-configured non-default
// torrentGoURL, then the host's playerServerURL, then a stored value. Trailing slash stripped.
export async function resolveTorrUrl() {
  const cleanTorrentGo = (PotokSDK.config.torrentGoURL || "").trim().replace(/\/$/, "");
  let torrUrl = "";
  if (cleanTorrentGo && cleanTorrentGo !== "https://torrent.potok.rip") {
    torrUrl = PotokSDK.config.torrentGoURL;
  } else {
    torrUrl = PotokSDK.config.playerServerURL || PotokSDK.config.torrentGoURL || "";
  }
  if (!torrUrl) {
    torrUrl = await PotokSDK.storage.local.getItem("torrentGoURL") || "";
  }
  return torrUrl.trim().replace(/\/$/, "");
}
