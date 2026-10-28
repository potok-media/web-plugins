export function createPageState() {
  return {
    routeKey: '',
    query: '',
    context: {},
    status: 'idle',
    items: [],
    errors: {},
    error: '',
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
}

export function resetPageFilters(state) {
  state.activeProvider = 'all';
  state.activeQuality = 'all';
  state.activeVoice = 'all';
}
