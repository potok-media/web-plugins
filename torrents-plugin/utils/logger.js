// Single logging choke-point for the plugin (WEB_ARCH §12 — no raw console.* scattered around). Flip DEBUG
// for verbose network diagnostics; errors always surface so graceful degradation (§7.1) never silently hides
// a real failure.
const DEBUG = false;

export const logger = {
  debug: (...args) => { if (DEBUG) console.info('[torrents]', ...args); },
  warn: (...args) => { if (DEBUG) console.warn('[torrents]', ...args); },
  error: (...args) => console.error('[torrents]', ...args),
};
