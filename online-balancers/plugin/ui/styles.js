import { PotokSDK } from './sdk.js';

export function installStyles() {
  PotokSDK.ui.injectHostCss('online-page', `
    .online-page { width: 100%; }

    .online-page .online-shell {
      width: 100%;
      max-width: var(--wide-shell-max-width);
      margin: 0 auto;
    }

    .online-page .online-results-toolbar {
      width: 100%;
      display: flex !important;
      align-items: flex-start !important;
      justify-content: space-between !important;
      gap: var(--space-xl);
    }

    .online-page .online-results-heading {
      flex: 1 1 auto;
      min-width: 16rem;
    }

    .online-page .online-results-controls {
      flex: 0 1 auto;
      min-width: 0;
      align-items: center !important;
      justify-content: flex-end !important;
    }

    .online-page .online-accounts-button { flex: 0 0 auto; }

    .overlay-panel--modal.online-account-modal {
      width: min(38rem, calc(100vw - (2 * var(--space-l, 1.25rem))));
      max-width: none;
      padding: var(--space-xl, 1.5rem);
      gap: var(--space-l, 1.25rem);
      box-sizing: border-box;
    }

    .online-account-modal > .overlay-title {
      padding: 0;
    }

    /* ── Activation code ─────────────────────────── */

    .online-activation-code {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-align: center;
      color: var(--text-primary);
      padding: var(--space-m) var(--space-l);
      background: var(--bg-surface-highest);
      border-radius: var(--radius-s);
      user-select: all;
      cursor: text;
      min-width: 8rem;
      flex: 1 1 auto;
      min-height: 0;
    }

    .online-activation-link {
      color: var(--accent);
      font: var(--font-metadata);
      text-decoration: underline;
      text-underline-offset: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1 1 auto;
      min-width: 0;
    }

    .online-activation-link:hover {
      opacity: 0.8;
    }

    .online-polling-spinner {
      width: 1rem;
      height: 1rem;
      border: 2px solid var(--border-color);
      border-top-color: var(--accent);
      border-radius: var(--radius-full);
      animation: online-spin 1s linear infinite;
      flex-shrink: 0;
    }

    @keyframes online-spin {
      to { transform: rotate(360deg); }
    }

    .online-confirm-btn {
      width: 100%;
    }

    .online-account-provider {
      width: 100%;
      min-width: 0;
    }

    .online-account-list,
    .online-account-provider {
      width: 100%;
      min-width: 0;
    }

    .online-account-card { width: 100%; }

    .online-account-actions {
      width: 100%;
      flex-wrap: wrap !important;
      justify-content: flex-end !important;
    }

    @media (max-width: 720px) {
      .overlay-panel--modal.online-account-modal {
        width: calc(100vw - (2 * var(--space-s, 0.5rem)));
        padding: var(--space-l, 1.25rem);
      }
    }

    .online-page .online-filter-row {
      width: auto;
      flex: 0 1 auto;
      min-width: 0;
      flex-wrap: nowrap !important;
      justify-content: flex-end !important;
      align-items: center !important;
      margin-left: auto;
    }

    .online-page .online-filter-control {
      flex: 0 0 auto;
      align-items: center !important;
      white-space: nowrap;
    }

    .online-page .online-filter-label {
      color: var(--text-secondary);
      font: var(--font-metadata);
    }

    .online-page .online-filter .filter-btn-trigger-relative {
      width: 100%;
      min-height: 2.5rem;
      padding: var(--space-xs) var(--space-s);
      justify-content: space-between;
    }

    .online-page .online-filter .filter-btn-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .online-page .online-filter-source { width: 8.5rem; }
    .online-page .online-filter-quality { width: 6.75rem; }
    .online-page .online-filter-voice { width: 10rem; }
    .online-page .online-results-grid { width: 100%; }
    .online-page .online-result-card { min-width: 0; }
    .online-page .online-result-card .media-card { width: 100%; }

    .online-page .online-result-selected .media-poster-wrap {
      outline: 2px solid var(--accent);
      outline-offset: 0.2rem;
    }

    @media (max-width: 1100px) {
      .online-page .online-results-toolbar {
        flex-wrap: wrap !important;
        gap: var(--space-m);
      }

      .online-page .online-results-controls {
        width: 100%;
        justify-content: space-between !important;
      }

      .online-page .online-filter-row {
        width: 100%;
        justify-content: flex-start !important;
        margin-left: 0;
        overflow-x: auto;
        overscroll-behavior-x: contain;
      }


      .online-page .online-results-controls {
        align-items: flex-start !important;
        flex-wrap: wrap !important;
      }
    }

      /* Result cards with provider chips (mock-driven layout; the host restyles on port). */
      .online-page .online-results-list,
      .online-page .online-loading-list { width: 100%; }

      /* ── Reference header: brand + query pill, filters row beneath ── */
      .online-page .online-header { width: 100%; align-items: center; flex-wrap: wrap; flex: 0 0 auto; }
      .online-page .online-brand { flex: 0 0 auto; font-size: 1.0625rem; font-weight: 700; letter-spacing: .3px; }
      .online-page .online-brand-base { color: var(--text-primary); }
      .online-page .online-brand-accent { color: var(--accent); }
      .online-page .online-query-pill {
        flex: 1 1 auto; min-width: 12rem;
        display: flex; align-items: center; gap: .5rem;
        background: var(--bg-surface, rgba(255, 255, 255, 0.04));
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: .625rem;
        padding: .5625rem .875rem;
        color: var(--text-secondary);
      }
      .online-page .online-query-pill-text {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        color: var(--text-primary);
      }
      .online-page .online-filters-row { width: 100%; align-items: center; flex-wrap: wrap; flex: 0 0 auto; }
      .online-page .online-filters-row .online-filter-row {
        margin-left: 0;
        justify-content: flex-start !important;
        flex-wrap: wrap !important;
      }

      /* Badges: small uppercase text labels next to the title — no boxes. */
      .online-page .online-badge-adult,
      .online-page .online-badge-adult * {
        background: transparent !important;
        color: #e5534b !important;
        font-size: 0.625rem !important;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 0 2px !important;
        border-radius: 0 !important;
        line-height: inherit;
      }

      /* Poster grid cards (the classic results view). */
      .online-page .online-results-grid { width: 100%; align-items: start; }
      .online-page .online-grid-card {
        position: relative;
        width: 100%;
        min-width: 0;
        flex: 0 0 auto;
      }
      .online-page .online-grid-poster-wrap { position: relative; width: 100%; flex: 0 0 auto; }
      .online-page .online-grid-provider-badge,
      .online-page .online-grid-provider-badge * {
        position: absolute !important;
        top: 0.375rem;
        right: 0.375rem;
        background: rgba(10, 11, 16, 0.72) !important;
        color: var(--text-primary) !important;
        font-size: 0.625rem !important;
        font-weight: 600;
        letter-spacing: 0.02em;
        padding: 2px 8px !important;
        border-radius: 999px !important;
        line-height: 1.4;
        backdrop-filter: blur(4px);
      }
      .online-page .online-grid-poster {
        width: 100%;
        aspect-ratio: 2 / 3;
        object-fit: cover;
        display: block;
        flex: 0 0 auto;
      }
      .online-page .online-grid-title-row { flex-wrap: wrap; width: 100%; flex: 0 0 auto; }
      .online-page .online-grid-title { font-weight: 600; font-size: 0.875rem; }
      .online-page .online-grid-meta { font-size: 0.75rem; opacity: 0.7; width: 100%; flex: 0 0 auto; }
      .online-page .online-grid-hit {
        position: absolute;
        inset: 0;
        width: 100% !important;
        height: 100%;
        opacity: 0;
        cursor: pointer;
        border-radius: var(--radius-m, 0.75rem);
      }
      .online-page .online-result-selected .online-grid-poster {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
      .online-page .online-poster-skeleton { min-height: 15rem; }

      .online-page .online-progress-pill {
        padding: 0.125rem 0.5rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font-size: 0.75rem;
        opacity: 0.85;
      }
      .online-page .online-progress-pill-error { color: var(--warning, #d9a03f); }

    @media (max-width: 720px) {
      .online-page .online-results-heading { min-width: 100%; }

      .online-page .online-filter-row {
        gap: var(--space-s) !important;
        align-items: center !important;
      }

      .online-page .online-filter-control {
        flex: 0 0 auto;
        justify-content: flex-start !important;
      }

      .online-page .online-filter-source { width: 7rem; }
      .online-page .online-filter-quality { width: 5.5rem; }
      .online-page .online-filter-voice { width: 7.5rem; }
    }
  `);
}
