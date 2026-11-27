// Single logging choke-point for the plugin (WEB_ARCH §12 — no raw console.* scattered around). Flip DEBUG
// for verbose network diagnostics; errors always surface so graceful degradation (§7.1) never silently hides
// a real failure.
import { PotokSDK } from 'potok-sdk';

const DEBUG = false;

function split(message, ...body) {
  if (body.length === 0) return [String(message)];
  return [String(message), body.length === 1 ? body[0] : body];
}

export const logger = {
  debug: (message, ...body) => {
    if (DEBUG) PotokSDK.logging.log(...split(`[torrents] ${message}`, ...body));
  },
  warn: (message, ...body) => PotokSDK.logging.warn(...split(`[torrents] ${message}`, ...body)),
  error: (message, ...body) => PotokSDK.logging.error(...split(`[torrents] ${message}`, ...body)),
};
