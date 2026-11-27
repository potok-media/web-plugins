import { PotokSDK } from 'potok-sdk';
import { runtimeConfig } from './runtime.js';

// Single source of truth for the TorrentGo base URL. Was copy-pasted verbatim in getEpisodes,
// getPlaybackInfo and status.js; deduped here. Prefers an explicitly-configured non-default
// torrentGoURL, then the host's playerServerURL. A value changed in this runtime is read from
// Core storage first so the settings UI takes effect without restarting the plugin.
export async function resolveTorrUrl() {
  const config = runtimeConfig();
  const stored = (await PotokSDK.storage.local.getItem("torrentGoURL") || "").trim();
  if (stored) return stored.replace(/\/+$/, "");
  const cleanTorrentGo = (config.torrentGoURL || "").trim().replace(/\/$/, "");
  let torrUrl = "";
  if (cleanTorrentGo && cleanTorrentGo !== "https://torrent.potok.rip") {
    torrUrl = config.torrentGoURL;
  } else {
    torrUrl = config.playerServerURL || config.torrentGoURL || "";
  }
  return torrUrl.trim().replace(/\/$/, "");
}

// The SearchEngine base URL (search AND overrides live there now). Runtime storage wins over
// the initial config snapshot so a settings change applies immediately.
// Returns "" when unset (callers decide: search throws, overrides skip gracefully). `http://` prefixed, trailing
// slash stripped — matches the shape the search() call was building inline.
export async function resolveSearchEngineUrl() {
  let base = (await PotokSDK.storage.local.getItem("searchEngineURL") || "").trim();
  if (!base) base = (runtimeConfig().searchEngineURL || "").trim();
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  return base.replace(/\/+$/, "");
}

// Reads the canonical setting and migrates the short-lived legacy spelling used by older builds.
export async function resolveStoredJacredUrl() {
  const canonical = (await PotokSDK.storage.local.getItem("jacredURL") || "").trim();
  if (canonical) return canonical;

  const legacy = (await PotokSDK.storage.local.getItem("jacredUrl") || "").trim();
  if (!legacy) return "";

  try {
    if (typeof PotokSDK.storage.local.setItem === "function") {
      await PotokSDK.storage.local.setItem("jacredURL", legacy);
    }
    if (typeof PotokSDK.storage.local.removeItem === "function") {
      await PotokSDK.storage.local.removeItem("jacredUrl");
    }
  } catch {
    // Migration is best-effort; the legacy value still keeps this search usable.
  }
  return legacy;
}

// JacRed API base URL. Runtime storage wins over the initial config snapshot. Trailing slash stripped.
export async function resolveJacredUrl() {
  let base = await resolveStoredJacredUrl();
  if (!base) base = (runtimeConfig().jacredURL || "").trim();
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  return base.replace(/\/+$/, "");
}

// JacRed API key. Runtime storage wins over the initial config snapshot.
export async function resolveJacredApiKey() {
  let key = (await PotokSDK.storage.local.getItem("jacredApiKey") || "").trim();
  if (!key) key = (runtimeConfig().jacredApiKey || "").trim();
  return key;
}

// Search source stored by the settings UI wins over the initial manifest config snapshot.
export async function resolveSearchSource() {
  let src = (await PotokSDK.storage.local.getItem("searchSource") || "").trim().toLowerCase();
  if (!src) src = (runtimeConfig().searchSource || "").trim().toLowerCase();
  if (src !== "potok" && src !== "jacred") src = "potok";
  return src;
}

// Resolve the search URL based on the selected source.
// Returns the base URL (without trailing slash) for the active search backend.
export async function resolveSearchUrl() {
  const source = await resolveSearchSource();
  return (source === "jacred")
    ? await resolveJacredUrl()
    : await resolveSearchEngineUrl();
}
