import assert from 'node:assert/strict';
import test from 'node:test';

test('plugin registers the online-balancers source and delegates the complete flow to its API', async () => {
  const registrations = [];
  const slots = [];
  const navigations = [];
  const injectedCss = [];
  const rendered = [];
  const played = [];
  const presented = [];
  let dismissed = 0;
  const translations = {};
  const pluginStorage = new Map();

  function component(type, value) {
    return {
      type,
      text: value,
      childrenList: [],
      variant() { return this; },
      icon() { return this; },
      style(value) { this.styleValue = value; return this; },
      label(value) { this.labelValue = value; return this; },
      title(value) { this.titleValue = value; return this; },
      subtitle(value) { this.subtitleValue = value; return this; },
      backdropSrc(value) { this.backdropSrcValue = value; return this; },
      level() { return this; },
      size() { return this; },
      bold() { return this; },
      color() { return this; },
      spacing() { return this; },
      alignItems() { return this; },
      justifyContent() { return this; },
      width() { return this; },
      height() { return this; },
      minWidth() { return this; },
      gap() { return this; },
      placeholder() { return this; },
      value(value) { this.valueValue = value; return this; },
      description() { return this; },
      actionLabel() { return this; },
      orientation() { return this; },
      items(items) { this.itemsValue = items; return this; },
      options(options) { this.optionsValue = options; return this; },
      item(item) { this.itemValue = item; return this; },
      isOpen(value) { this.openValue = value; return this; },
      open(value) { this.openValue = value; return this; },
      closeOnBackdrop(value) { this.closeOnBackdropValue = value; return this; },
      inputType(value) { this.inputTypeValue = value; return this; },
      presentation(value) { this.presentationValue = value; return this; },
      activeEpisodeId(value) { this.activeEpisodeIdValue = value; return this; },
      canReorder(value) { this.canReorderValue = value; return this; },
      episodes(episodes) { this.episodesValue = episodes; return this; },
      seasonsLoading() { return this; },
      active() { return this; },
      rounded() { return this; },
      fit() { return this; },
      placement() { return this; },
      count() { return this; },
      child(child) { this.childrenList.push(child); return this; },
      children(children) { this.childrenList = children; return this; },
      onClick(callback) { this.click = callback; return this; },
      onChange(callback) { this.change = callback; return this; },
      onSelect(callback) { this.select = callback; return this; },
      onClear(callback) { this.clear = callback; return this; },
      onClose(callback) { this.close = callback; return this; },
      onPlay(callback) { this.play = callback; return this; },
      onReorder(callback) { this.reorder = callback; return this; },
      onAction(callback) { this.action = callback; return this; },
      onCardClick(callback) { this.cardClick = callback; return this; },
    };
  }

  globalThis.document = { baseURI: 'https://api.test/plugin/' };
  globalThis.PotokSDK = {
    storage: {
      local: {
        async getItem(key) { return pluginStorage.get(key) ?? null; },
        async setItem(key, value) { pluginStorage.set(key, value); },
        async removeItem(key) { pluginStorage.delete(key); },
      },
    },
    i18n: {
      registerTranslations(next) { Object.assign(translations, next); },
      t(key, options = {}) {
        const [namespace, path] = key.split(':');
        const language = translations.ru?.[namespace] || {};
        const segments = path.split('.');
        let value = segments.reduce((current, segment) => current?.[segment], language);
        if (value == null && options.count != null) {
          const count = Number(options.count);
          const suffix = count % 10 === 1 && count % 100 !== 11
            ? 'one'
            : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)
              ? 'few'
              : 'many';
          const pluralPath = [...segments.slice(0, -1), `${segments.at(-1)}_${suffix}`];
          value = pluralPath.reduce((current, segment) => current?.[segment], language);
        }
        return String(value ?? key).replace(/{{(\w+)}}/g, (_match, name) => String(options[name] ?? ''));
      },
    },
    streams: { registerStreamSource(source) { registrations.push(source); } },
    registerSlotContribution(slot) { slots.push(slot); },
    ui: {
      components: new Proxy({}, {
        get(_target, type) {
          return (value) => component(String(type), value);
        },
      }),
      navigateTo(path, state) { navigations.push({ path, state }); },
      injectHostCss(id, css) { injectedCss.push({ id, css }); },
      render(layout, id) { rendered.push({ layout, id }); },
      showHUD() {},
      showEpisodeSelector() {},
      presentEpisodes(payload) { presented.push(payload); },
      dismissEpisodes() { dismissed += 1; },
      playVideo(playback) { played.push(playback); },
    },
  };

  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const path = new URL(url).pathname;
    const payload = path.endsWith('/search')
      ? { items: [
        { provider: 'aniliberty', providerName: 'AniLiberty', sourceId: '42', title: 'Anime', originalTitle: 'Anime', quality: '1080p', mediaType: 'tv' },
        { provider: 'kodik', providerName: 'Kodik', sourceId: '43', title: 'Anime', originalTitle: 'Anime', quality: '720p', voice: 'AniDUB', mediaType: 'tv' },
        { provider: 'kodik', providerName: 'Kodik', sourceId: '44', title: 'Anime', originalTitle: 'Anime', quality: '720p', voice: 'SHIZA', mediaType: 'tv' },
        { provider: 'kodik', providerName: 'Kodik', sourceId: '45', title: 'Other', originalTitle: 'Other', quality: '720p', voice: 'AniDUB', mediaType: 'tv' },
      ] }
      : path.endsWith('/episodes')
        ? (() => {
          const sourceId = JSON.parse(options.body).sourceId;
          const voice = { 43: 'AniDUB', 44: 'SHIZA' }[sourceId];
          return {
            episodes: [
              {
                id: 'ep-1',
                season: 1,
                number: 1,
                title: '1 серия',
                url: `https://api.test/playback?sourceId=${sourceId}&ep=1`,
                voice,
                audios: [],
              },
              {
                id: 'ep-2',
                season: 1,
                number: 2,
                title: '2 серия',
                url: `https://api.test/playback?sourceId=${sourceId}&ep=2`,
                voice,
                audios: [],
              },
            ],
            seasonsCount: 1,
          };
        })()
        : (() => {
          const body = JSON.parse(options.body);
          // Extract sourceId from session for refresh requests
          const sessionMatch = body.session?.match(/^session-(.+)$/);
          const sourceId = body.sourceId || sessionMatch?.[1];
          const voice = body.voice && { 42: 'AniLiberty', 43: 'AniDUB', 44: 'SHIZA' }[body.voice]
            || { 42: 'AniLiberty', 43: 'AniDUB', 44: 'SHIZA' }[sourceId]
            || 'Основной';
          return {
            streamUrl: `https://api.test/stream/${sourceId || 'signed'}.m3u8`,
            streamType: 'm3u8',
            voice,
            session: body.session || `session-${sourceId || '1'}`,
          };
        })();
    return { ok: true, json: async () => payload };
  };

  await import(`../plugin/index.js?test=${Date.now()}`);

  assert.equal(registrations.length, 1);
  assert.equal(slots.length, 2);
  assert.equal(injectedCss.length, 1);
  assert.match(injectedCss[0].css, /\.online-page/);
  assert.match(injectedCss[0].css, /\.online-results-toolbar/);
  assert.match(injectedCss[0].css, /\.online-filter-row/);
  assert.match(injectedCss[0].css, /flex-wrap: nowrap !important/);
  assert.match(injectedCss[0].css, /overflow-x: auto/);
  assert.doesNotMatch(injectedCss[0].css, /flex: 1 1 12rem/);
  assert.doesNotMatch(injectedCss[0].css, /online-search/);
  assert.equal(translations.ru['potok-online-balancers'].action.watch, 'Онлайн');
  const provider = registrations[0];
  assert.equal(provider.id, 'potok-online-balancers');

  const actionSlot = slots.find(slot => slot.slotName === 'media-actions');
  const action = actionSlot.render({ mediaType: 'tv', mediaId: 10, title: 'Anime 2: Final!!!' });
  assert.equal(action.label, 'Онлайн');
  assert.equal(action.layout.text, 'Онлайн');
  action.layout.click();
  const pageUrl = new URL(navigations[0].path, 'https://potok.test');
  assert.equal(pageUrl.pathname, '/extensions/potok-online-balancers');
  assert.equal(pageUrl.searchParams.get('q'), 'Anime Final');
  assert.equal(pageUrl.searchParams.get('type'), 'tv');

  const pageSlot = slots.find(slot => slot.slotName === 'extension-page');
  const page = pageSlot.render({ query: {} });
  assert.equal(page.label, 'Онлайн');
  assert.equal(page.layout.type, 'Page');
  assert.equal(page.layout.titleValue, undefined);

  const streams = await provider.search({ type: 'tv', title: 'Anime', year: null, tmdbId: '' });
  assert.equal(streams[0].providerId, 'aniliberty');
  assert.equal(streams[0].title, 'Anime');
  assert.equal(calls[0].body.query.year, null);
  assert.equal(calls[0].body.query.tmdbId, null);

  const episodeResult = await provider.getEpisodes(streams[0], { type: 'tv', title: 'Anime' });
  assert.equal(episodeResult.episodes[0].episode, 1);
  assert.equal(episodeResult.episodes[0].url, 'https://api.test/playback?sourceId=42&ep=1');

  const normalizedEpisode = {
    ...episodeResult.episodes[0],
    locator: undefined,
  };
  const playback = await provider.getPlaybackInfo({ stream: streams[0], episode: normalizedEpisode, context: { type: 'tv', title: 'Anime' } });
  // The streamUrl is the backend's resolved URL verbatim — no `?audio=N` suffix appended.
  assert.equal(playback.streamUrl, 'https://api.test/stream/42.m3u8');
  assert.equal(playback.streamType, 'm3u8');
  // One candidate (the episode itself): it keeps its provider identity and its own directly
  // playable url — no fabricated `?audio=N` link into the resolved stream.
  assert.deepEqual(playback.audios, [
    {
      name: 'AniLiberty',
      label: null,
      voice: null,
      providerId: 'aniliberty',
      sourceId: '42',
      query: { imdbId: null, kinopoiskId: null, originalTitle: null, title: 'Anime', tmdbId: null, type: 'tv', year: null },
      url: 'https://api.test/playback?sourceId=42&ep=1',
    },
  ]);
  assert.equal(playback.providerId, 'potok-online-balancers');
  // Streaming search: ONE request carrying every free provider.
  assert.equal(calls[0].body.providers.length, 10);
  assert.equal(calls[2].body.season, 1);
  assert.equal(calls[2].body.episode, 1);

  const directPlayback = await provider.getPlaybackInfo({ stream: streams[0], episode: undefined, context: { type: 'movie', title: 'Anime' } });
  assert.equal(directPlayback.episode, 1);
  // The second getPlaybackInfo resolves the same episode (S1E1) which is served from cache,
  // so no additional /api/v1/playback call is made — the cached streamUrl is reused.
  assert.equal(calls.length, 4);

  const refreshed = await provider.refreshStreamUrl({ providerId: 'potok-online-balancers' });
  assert.equal(refreshed.streamUrl, 'https://api.test/stream/42.m3u8');
  assert.equal(calls[4].body.session, 'session-42');
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
    '/api/v1/search',
    '/api/v1/episodes',
    '/api/v1/playback',
    '/api/v1/episodes',
    '/api/v1/refresh',
  ]);

  const queriedPage = pageSlot.render({ query: { q: 'Anime 2024!!!' } });
  const loadingContent = queriedPage.layout.childrenList[0].childrenList[0];
  assert.equal(loadingContent.childrenList[0].styleValue, 'online-header');
  assert.equal(loadingContent.childrenList[0].childrenList[0].childrenList[0].text, 'Potok ');
  assert.equal(loadingContent.childrenList[0].childrenList[0].childrenList[1].text, 'Online');

  // The search now emits partial renders as providers respond — wait for the final
  // ready render (the one carrying the filters row) instead of a single tick.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const latest = rendered.at(-1)?.layout;
    const latestFiltersRow = latest?.childrenList?.[0]?.childrenList?.[0]?.childrenList?.[1];
    if (latestFiltersRow?.styleValue === 'online-filters-row') break;
    await new Promise(resolve => setImmediate(resolve));
  }
  const readyShell = rendered.at(-1).layout.childrenList[0];
  const readyContent = readyShell.childrenList[0];
  const header = readyContent.childrenList[0];
  assert.equal(header.styleValue, 'online-header');
  assert.equal(header.childrenList[0].childrenList[0].text, 'Potok ');
  assert.equal(header.childrenList[0].childrenList[1].text, 'Online');
  assert.equal(header.childrenList[1].styleValue, 'online-query-pill');
  assert.equal(header.childrenList[1].childrenList[1].text, 'Anime');
  const filtersRow = readyContent.childrenList[1];
  assert.equal(filtersRow.styleValue, 'online-filters-row');
  const filters = filtersRow.childrenList[0];
  assert.equal(filters.styleValue, 'online-filter-row');
  assert.deepEqual(filters.childrenList.map(item => item.childrenList[0].text), ['Источник', 'Качество', 'Озвучка']);
  const selects = filters.childrenList.map(item => item.childrenList[1]);
  assert.deepEqual(selects.map(item => item.type), ['Select', 'Select', 'Select']);
  assert.deepEqual(selects[0].optionsValue.map(item => item.label), [
    'Все',
    'AniLiberty',
    'Kodik',
    'Alloha · Подключить аккаунт',
    'Filmix · Подключить аккаунт',
    'KinoWatch (KinoPub) · Подключить аккаунт',
    'Rezka · Подключить аккаунт',
  ]);
  assert.deepEqual(selects[1].optionsValue.map(item => item.label), ['Все', '1080p', '720p']);
  assert.deepEqual(selects[2].optionsValue.map(item => item.label), ['Все', 'AniDUB', 'AniLiberty', 'SHIZA']);
  assert.equal(header.childrenList[2].text, "Аккаунты");
  header.childrenList[2].click();
  const accountRoot = rendered.at(-1).layout;
  assert.equal(accountRoot.type, 'VStack');
  const accountModal = accountRoot.childrenList[1];
  assert.equal(accountModal.type, 'Modal');
  assert.equal(accountModal.openValue, true);
  assert.equal(accountModal.titleValue, 'Аккаунты источников');
  assert.equal(accountModal.childrenList[0].childrenList.length, 4);
  accountModal.close();
  assert.equal(rendered.at(-1).layout.type, 'Page');
  selects[0].change('alloha');
  const allohaModal = rendered.at(-1).layout.childrenList[1];
  assert.equal(allohaModal.titleValue, 'Alloha');
  allohaModal.close();
  const resultsList = readyContent.childrenList.find(item => item.styleValue === 'online-results-grid');
  assert.ok(resultsList, 'expected the results grid');
  assert.equal(resultsList.childrenList.length, 2);
  const firstCard = resultsList.childrenList[0];
  assert.equal(firstCard.styleValue, 'online-grid-card');
  // Grid card: poster, title with badges, meta line and the full-card hit button.
  assert.ok(firstCard.childrenList.some(child => child.styleValue === 'online-grid-hit'),
    'expected the full-card hit button');

  // The hit button opens the source.
  const hit = firstCard.childrenList.find(child => child.styleValue === 'online-grid-hit');
  await hit.click();
  // The plugin renders the playback stage only — the episode panel is the host's job now, fed with
  // the episodes presented below (ui.presentEpisodes).
  const selectorWorkspace = rendered.at(-1).layout;
  assert.equal(selectorWorkspace.type, 'PlaybackWorkspace');
  assert.equal(selectorWorkspace.childrenList.length, 0);
  assert.equal(presented.length, 1);
  const panel = presented[0];
  assert.equal(panel.title, 'Anime');
  assert.equal(panel.canReorder, true);
  assert.equal(panel.episodes.length, 2);
  assert.equal(panel.episodes[0].audios.length, 3);
  assert.deepEqual(
    panel.episodes[0].audios.map(audio => audio.voice).sort(),
    ['AniDUB', 'AniLiberty', 'SHIZA'],
  );

  panel.onReorder([...panel.episodes].reverse());
  assert.equal(presented.length, 2);
  assert.deepEqual(presented[1].episodes.map(episode => episode.id), ['1:2', '1:1']);

  presented[1].onPlay(presented[1].episodes[1]);
  assert.equal(rendered.at(-1).layout.type, 'PlaybackWorkspace');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(played.length, 1);
  assert.equal(played[0].voice, 'AniLiberty');
  assert.equal(played[0].streamType, 'm3u8');
  assert.equal(played[0].streamUrl, 'https://api.test/stream/42.m3u8');
  // One upstream resolution, but the descriptor carries every voice variant of the episode.
  // The FULL "Voice · Quality · Provider" label is the canonical name (the balancer identity in
  // it is information, not noise); the plain voice label and each candidate's OWN provider
  // identity (the merged list spans AniLiberty + two Kodik sources) ride along — urls are the
  // candidates' own links, never fabricated `?audio=N` variants of one stream.
  const mergedQuery = { imdbId: null, kinopoiskId: null, originalTitle: null, title: 'Anime', tmdbId: null, type: null, year: null };
  assert.deepEqual(played[0].audios, [
    {
      name: 'AniLiberty · 1080p · AniLiberty', label: 'AniLiberty · 1080p · AniLiberty',
      voice: 'AniLiberty', providerId: 'aniliberty', sourceId: '42', query: mergedQuery,
      url: 'https://api.test/playback?sourceId=42&ep=1',
    },
    {
      name: 'AniDUB · 720p · Kodik', label: 'AniDUB · 720p · Kodik',
      voice: 'AniDUB', providerId: 'kodik', sourceId: '43', query: mergedQuery,
      url: 'https://api.test/playback?sourceId=43&ep=1',
    },
    {
      name: 'SHIZA · 720p · Kodik', label: 'SHIZA · 720p · Kodik',
      voice: 'SHIZA', providerId: 'kodik', sourceId: '44', query: mergedQuery,
      url: 'https://api.test/playback?sourceId=44&ep=1',
    },
  ]);
  const groupedPlaybackCalls = calls.filter(call => new URL(call.url).pathname === '/api/v1/playback');
  assert.deepEqual(groupedPlaybackCalls.map(call => call.body.sourceId), ['42']);
  // voice field is optional in resolvePlayback — only used for logging
  assert.equal(groupedPlaybackCalls.length, 1);
});
