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
    /* The custom sidebar control keeps the same compact proportions as the settings form. */
    .potok-torrents-settings-source .pt-select {
      min-width: 120px !important;
    }

    /* Declarative settings: source selector on the left, active address on the right. */
    .declarative-inline-row:has(#config-potok-torrents-searchSource) {
      display: grid !important;
      grid-template-columns: minmax(9rem, 0.4fr) minmax(16rem, 1fr);
      align-items: end !important;
      gap: var(--space-m, 1rem) !important;
      width: 100%;
    }

    .declarative-inline-row:has(#config-potok-torrents-searchSource) > .ui-inline-field {
      width: 100%;
      min-width: 0;
    }

    .declarative-inline-row:has(#config-potok-torrents-searchSource) .ui-inline-field:has(#config-potok-torrents-searchEngineURL) {
      display: none;
    }

    .declarative-inline-row:has(#config-potok-torrents-searchSource):has(option[value="potok"]:checked) .ui-inline-field:has(#config-potok-torrents-jacredURL) {
      display: none;
    }

    .declarative-inline-row:has(#config-potok-torrents-searchSource):has(option[value="potok"]:checked) .ui-inline-field:has(#config-potok-torrents-searchEngineURL) {
      display: flex;
    }

    .settings-card-form:has(#config-potok-torrents-searchSource option[value="potok"]:checked) .settings-form-group:has(#config-potok-torrents-jacredApiKey) {
      display: none;
    }

    @media (max-width: 720px) {
      .declarative-inline-row:has(#config-potok-torrents-searchSource) {
        grid-template-columns: 1fr;
        align-items: stretch !important;
      }
    }
  `);
}
