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

// The SearchEngine base URL (search AND overrides live there now). Prefers configured value, then stored value.
// Returns "" when unset (callers decide: search throws, overrides skip gracefully). `http://` prefixed, trailing
// slash stripped — matches the shape the search() call was building inline.
export async function resolveSearchEngineUrl() {
  let base = (PotokSDK.config.searchEngineURL || "").trim();
  if (!base) {
    base = (await PotokSDK.storage.local.getItem("searchEngineURL") || "").trim();
  }
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  return base.replace(/\/+$/, "");
}
