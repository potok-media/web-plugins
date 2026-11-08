export function createPageState() {
  return {
    routeKey: '',
    query: '',
    context: {},
    status: 'idle',
    items: [],
    errors: {},
    error: '',
    // Per-provider search status: 'loading' | 'ok' | 'empty' | 'error' | 'locked'.
    // Drives the result-card chips (shimmer while pending, retry on soft errors, the
    // accounts modal for locked account providers).
    providerStatus: {},
    // Result cards with the provider tail expanded (the "+N more" toggle), keyed by group id.
    expandedTails: {},
    activeProvider: 'all',
    activeQuality: 'all',
    activeVoice: 'all',
    selectedId: '',
    selectedStream: null,
    selectedEpisodes: [],
    activeEpisodeId: '',
    episodeSelectorOpen: false,
    episodeStatus: 'idle',
    episodeError: '',
    /** An episode play is being resolved upstream (playVideo not dispatched yet) — the stage shows loading. */
    playbackPending: false,
    accounts: {},
    accountsOpen: false,
    accountProvider: '',
    accountStatus: 'idle',
    accountError: '',
    accountDraft: {
      label: '',
      apiToken: '',
      secretToken: '',
      host: 'https://rezka.ag',
      login: '',
      password: '',
    },
    kinoPubDevice: null,
    kinoPubPollTimer: null,
    filmixDevice: null,
  };
}

export function resetPageSelection(state) {
  state.selectedId = '';
  state.selectedStream = null;
  state.selectedEpisodes = [];
  state.activeEpisodeId = '';
  state.episodeSelectorOpen = false;
  state.episodeStatus = 'idle';
  state.episodeError = '';
  state.playbackPending = false;
}

export function resetPageFilters(state) {
  state.activeProvider = 'all';
  state.activeQuality = 'all';
  state.activeVoice = 'all';
}
