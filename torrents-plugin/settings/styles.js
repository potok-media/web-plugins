import { injectHostCss } from './sdk.js';

/**
 * Install custom CSS for the search-source settings layout.
 * Safe to call multiple times — guarded by module-level flag.
 */
let installed = false;

export function installStyles() {
  if (installed) return;
  installed = true;

  injectHostCss('potok-torrents-settings', `
    /* Ensure the select dropdown has enough width to show its options clearly */
    .potok-torrents-settings-source .pt-select {
      min-width: 120px !important;
    }
  `);
}
