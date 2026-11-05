import { pageContextFromRoute } from '../routing/mediaContext.js';
import { selectAudio } from '../playback/playbackController.js';
import { sourceSubtitle } from '../media/sourceMeta.js';
import { resetPageFilters, resetPageSelection } from './state.js';

export function createAppController({
  state,
  searchService,
  episodeService,
  playbackService,
  accountVault,
  client,
  registry,
  ui,
  translate,
}) {
  let render = () => {};
  let searchRevision = 0;

  function emit() {
    render();
  }

  async function loadAccounts({ renderResult = true } = {}) {
    const accounts = await accountVault.loadAccounts();
    state.accounts = Object.fromEntries(Object.entries(accounts).map(([providerId, account]) => [providerId, {
      connected: true,
      label: account.label || '',
      ...(providerId === 'rezka' && account.host ? { host: account.host } : {}),
    }]));
    if (renderResult) emit();
    return state.accounts;
  }

  function resetAccountFlow() {
    stopAutoPoll();
    state.accountStatus = 'idle';
    state.accountError = '';
    state.kinoPubDevice = null;
    state.accountDraft = {
      label: '',
      apiToken: '',
      secretToken: '',
      host: 'https://rezka.ag',
      login: '',
      password: '',
    };
  }

  async function finishAccountChange(providerId, account = null) {
    if (account) await accountVault.saveAccount(providerId, account);
    else await accountVault.removeAccount(providerId);
    await loadAccounts({ renderResult: false });
    state.accountProvider = '';
    resetAccountFlow();
    emit();
    if (state.context.title) await runSearch(true);
  }

  async function runAccountAction(action) {
    if (state.accountStatus === 'loading') return;
    state.accountStatus = 'loading';
    state.accountError = '';
    emit();
    try {
      await action();
    } catch (error) {
      state.accountStatus = 'error';
      state.accountError = error instanceof Error ? error.message : String(error);
      state.accountDraft.password = '';
      emit();
    }
  }

  function stopAutoPoll() {
    const timer = state.kinoPubPollTimer;
    if (timer) {
      clearInterval(timer);
      state.kinoPubPollTimer = null;
    }
  }

  function startAutoPoll() {
    stopAutoPoll();
    if (!state.kinoPubDevice?.code) return;
    const interval = (state.kinoPubDevice.interval ?? 5) * 1000;
    state.kinoPubPollTimer = setInterval(async () => {
      if (!state.kinoPubDevice?.code) { stopAutoPoll(); return; }
      try {
        const result = await client.pollKinoPubDevice(state.kinoPubDevice.code);
        if (result.account) {
          stopAutoPoll();
          await finishAccountChange('kinopub', result.account.values);
        }
      } catch {
        // polling errors are expected until user activates the device
      }
    }, interval);
  }

  function openAccountProvider(providerId) {
    const provider = registry.accounts.find(item => item.id === providerId);
    if (!provider) return;
    resetAccountFlow();
    state.accountsOpen = true;
    state.accountProvider = provider.id;
    const account = state.accounts[provider.id] || {};
    state.accountDraft = {
      ...state.accountDraft,
      label: account.label || '',
      apiToken: '',
      secretToken: '',
      host: account.host || 'https://rezka.ag',
      login: account.label || '',
    };
    emit();
  }

  async function runSearch(renderLoading = true) {
    const revision = ++searchRevision;
    state.status = 'loading';
    state.error = '';
    state.errors = {};
    state.items = [];
    resetPageFilters(state);
    if (renderLoading) emit();
    try {
      const result = await searchService.search(state.context);
      if (revision !== searchRevision) return;
      // Casting only annotates sources with ARM entryId — bound and uncast items display together.
      state.items = [...result.items, ...(result.unresolvedItems || [])];
      state.errors = result.errors;
      state.status = 'ready';
    } catch (error) {
      if (revision !== searchRevision) return;
      state.status = 'error';
      state.error = error instanceof Error ? error.message : String(error);
    }
    emit();
  }

  function applyRoute(props) {
    const context = pageContextFromRoute(props?.query || {});
    const routeKey = JSON.stringify(context);
    if (routeKey === state.routeKey) return;

    searchRevision += 1;
    state.routeKey = routeKey;
    state.context = context;
    state.query = context.title || '';
    state.status = context.title ? 'loading' : 'idle';
    state.items = [];
    state.errors = {};
    state.error = '';
    resetPageFilters(state);
    resetPageSelection(state);
    ui.dismissEpisodes?.();
    if (context.title) void runSearch(false);
  }

  // Episodes travel to the host as data (ui.presentEpisodes): the host renders its own episode panel
  // in the workspace rail and routes play/reorder/close back through the callbacks registered here.
  function presentSelectedEpisodes() {
    if (!state.episodeSelectorOpen || !state.selectedStream) return;
    ui.presentEpisodes?.({
      title: state.selectedStream.title || state.context.title || '',
      subtitle: sourceSubtitle(state.selectedStream, translate),
      episodes: state.selectedEpisodes,
      canReorder: true,
      onPlay: (episode, audioId) => actions.playEpisode(episode, audioId),
      onClose: () => actions.closeEpisodeSelector(),
      onReorder: (episodes) => actions.reorderEpisodes(episodes),
    });
  }

  async function playEpisode(group, episode, audioId = null) {
    try {
      ui.showHUD('info', translate('playback.opening'));
      const selected = selectAudio(episode, audioId);
      const stream = group.variants.find(item =>
        item.providerId === selected?.providerId && item.sourceId === selected?.sourceId)
        || group.variants[0];
      const playbackEpisode = group.mediaType === 'movie'
        ? { ...selected, season: null, episode: null }
        : selected;
      await playbackService.play(
        stream,
        playbackEpisode,
        state.context,
        group.mediaType === 'movie' ? undefined : state.selectedEpisodes,
        group.mediaType === 'movie' ? undefined : String(selected?.id || ''),
      );
    } catch (error) {
      ui.showHUD('error', error instanceof Error ? error.message : String(error));
    }
  }

  async function openSource(group) {
    const routeKey = state.routeKey;
    state.selectedId = group.id;
    state.selectedStream = group;
    state.selectedEpisodes = [];
    state.activeEpisodeId = '';
    state.episodeSelectorOpen = false;
    state.episodeStatus = 'loading';
    state.episodeError = '';
    ui.dismissEpisodes?.();
    emit();
    try {
      const result = await episodeService.fetchGroupedEpisodes(group, state.context);
      if (state.routeKey !== routeKey || state.selectedId !== group.id) return;
      if (!result.episodes.length) throw new Error(translate('episodes.empty'));
      state.episodeStatus = 'ready';
      state.selectedEpisodes = result.episodes;
      state.episodeSelectorOpen = true;
      const first = result.episodes[0];
      const shouldAutoplay = result.episodes.length === 1 && (first.audios?.length || 0) <= 1;
      if (shouldAutoplay) state.activeEpisodeId = String(first.id || '');
      presentSelectedEpisodes();
      emit();
      if (shouldAutoplay) await playEpisode(group, first);
    } catch (error) {
      if (state.routeKey !== routeKey || state.selectedId !== group.id) return;
      state.episodeStatus = 'error';
      state.episodeError = error instanceof Error ? error.message : String(error);
      emit();
      ui.showHUD('error', state.episodeError);
    }
  }

  const actions = Object.freeze({
    retrySearch() { return runSearch(true); },
    openSource,
    closeEpisodeSelector() {
      ui.dismissEpisodes?.();
      ui.stopVideo?.();
      resetPageSelection(state);
      emit();
    },
    reorderEpisodes(episodes) {
      if (!Array.isArray(episodes)) return;
      state.selectedEpisodes = episodes;
      presentSelectedEpisodes();
      emit();
    },
    playEpisode(episode, audioId) {
      if (!state.selectedStream) return;
      state.activeEpisodeId = String(episode?.id || '');
      emit();
      void playEpisode(state.selectedStream, episode, audioId);
    },
    setProvider(value) {
      const providerId = value || 'all';
      const provider = registry.get(providerId);
      if (provider?.access === 'account' && !state.accounts[providerId]) {
        openAccountProvider(providerId);
        return;
      }
      state.activeProvider = providerId;
      emit();
    },
    setQuality(value) {
      state.activeQuality = value || 'all';
      emit();
    },
    setVoice(value) {
      state.activeVoice = value || 'all';
      emit();
    },
    openAccounts() {
      state.accountsOpen = true;
      state.accountProvider = '';
      resetAccountFlow();
      emit();
      void loadAccounts();
    },
    closeAccounts() {
      state.accountsOpen = false;
      state.accountProvider = '';
      resetAccountFlow();
      emit();
    },
    openAccountProvider(providerId) {
      openAccountProvider(providerId);
    },
    closeAccountProvider() {
      state.accountProvider = '';
      resetAccountFlow();
      emit();
    },
    setAccountField(field, value) {
      if (!Object.hasOwn(state.accountDraft, field)) return;
      state.accountDraft[field] = String(value || '');
      emit();
    },
    saveAlloha() {
      void runAccountAction(async () => {
        const { apiToken, secretToken, label } = state.accountDraft;
        if (!apiToken.trim() || !secretToken.trim()) throw new Error(translate('accounts.required'));
        await finishAccountChange('alloha', {
          apiToken: apiToken.trim(),
          secretToken: secretToken.trim(),
          ...(label.trim() ? { label: label.trim() } : {}),
        });
      });
    },
    startKinoPub() {
      void runAccountAction(async () => {
        const device = await client.startKinoPubDevice();
        device.expiresAt = Date.now() + (device.expiresIn ?? 300) * 1000;
        state.kinoPubDevice = device;
        state.accountStatus = 'ready';
        emit();
        startAutoPoll();
      });
    },
    pollKinoPub() {
      if (!state.kinoPubDevice?.code) return;
      void runAccountAction(async () => {
        const result = await client.pollKinoPubDevice(state.kinoPubDevice.code);
        if (result.account) {
          await finishAccountChange('kinopub', result.account.values);
        }
      });
    },
    loginRezka() {
      const credentials = {
        host: state.accountDraft.host.trim(),
        login: state.accountDraft.login.trim(),
        password: state.accountDraft.password,
      };
      state.accountDraft.password = '';
      void runAccountAction(async () => {
        const result = await client.loginRezka(credentials);
        await finishAccountChange('rezka', result.account?.values);
      });
    },
    disconnectAccount(providerId) {
      void runAccountAction(() => finishAccountChange(providerId));
    },
  });

  return Object.freeze({
    state,
    actions,
    applyRoute,
    loadAccounts,
    setRenderer(callback) { render = typeof callback === 'function' ? callback : () => {}; },
  });
}
