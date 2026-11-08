import assert from 'node:assert/strict';
import test from 'node:test';

// Poster-grid results: skeleton cards during the flight, real cards once provider chunks
// land, and the full-card hit button opens the source.
test('results render as a poster grid with skeletons and a full-card hit area', async () => {
  globalThis.document = { baseURI: 'https://api.test/plugin/' };

  const translations = {};
  const rendered = [];
  const presented = [];
  globalThis.document = { baseURI: 'https://api.test/plugin/' };
  const component = (type, value) => ({
    type,
    text: value,
    childrenList: [],
    variant() { return this; },
    icon(v) { this.iconValue = v; return this; },
    style(v) { this.styleValue = this.styleValue ? `${this.styleValue} ${v}` : v; return this; },
    label(v) { this.labelValue = v; return this; },
    title(v) { this.titleValue = v; return this; },
    subtitle(v) { this.subtitleValue = v; return this; },
    spacing() { return this; },
    gap() { return this; },
    alignItems() { return this; },
    justifyContent() { return this; },
    width() { return this; },
    height() { return this; },
    minWidth() { return this; },
    rounded() { return this; },
    fit() { return this; },
    placement() { return this; },
    size() { return this; },
    active() { return this; },
    open(v) { this.openValue = v; return this; },
    items() { return this; },
    options(v) { this.optionsValue = v; return this; },
    value() { return this; },
    child(child) { this.childrenList.push(child); return this; },
    children(children) { this.childrenList = children; return this; },
    onClick(callback) { this.click = callback; return this; },
    onChange() { return this; },
    onClose() { return this; },
    onAction() { return this; },
    actionLabel() { return this; },
    backdropSrc() { return this; },
    loading(v) { this.loadingValue = v; return this; },
    description() { return this; },
  });

  // The vault stores one document under its own storage key.
  const pluginStorage = new Map([
    ['provider-accounts', JSON.stringify({ version: 1, accounts: { filmix: { accessToken: 'tok' } } })],
  ]);
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
      language: 'ru',
      t(key, options = {}) {
        const [namespace, path] = key.split(':');
        const language = translations.ru?.[namespace] || {};
        const value = path.split('.').reduce((current, segment) => current?.[segment], language);
        return String(value ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options[name] ?? ''));
      },
    },
    streams: { registerStreamSource() {} },
    registerSlotContribution() {},
    ui: {
      components: new Proxy({}, { get: (_target, type) => (value) => component(String(type), value) }),
      navigateTo() {},
      injectHostCss() {},
      render(layout) { rendered.push({ layout }); },
      showHUD() {},
      presentEpisodes(panel) { presented.push(panel); },
      dismissEpisodes() {},
      playVideo() {},
    },
  };

  const requests = [];
  // NDJSON streaming mock: one line per finished provider (result or error), then the
  // done chunk. Lines after the first carry delays so the UI renders intermediate states.
  const encoder = new TextEncoder();
  const ndjsonBody = (lines) => {
    let index = 0;
    return {
      getReader: () => ({
        read: () => {
          if (index >= lines.length) return Promise.resolve({ done: true, value: undefined });
          const entry = lines[index++];
          return new Promise(resolve => setTimeout(
            () => resolve({ done: false, value: encoder.encode(`${entry.line}\n`) }),
            entry.delay ?? 0,
          ));
        },
      }),
    };
  };
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const path = new URL(url).pathname;
    if (path === '/api/v1/episodes') {
      return { ok: true, json: async () => ({ episodes: [{ id: 'e1', number: 1, title: 'Эпизод 1' }], seasonsCount: 1 }) };
    }
    if (path !== '/api/v1/search') return { ok: true, json: async () => ({}) };
    const providers = body.providers || [];
    const isSingle = providers.length === 1;
    const allItems = [
      { provider: 'kodik', providerName: 'Kodik', sourceId: '1', title: 'Тайтл', quality: '720p', voice: 'AniDUB', mediaType: 'tv' },
      { provider: 'aniliberty', providerName: 'AniLiberty', sourceId: '2', title: 'Тайтл', originalTitle: 'Title', quality: '1080p', mediaType: 'tv' },
      { provider: 'animelib', providerName: 'AnimeLib', sourceId: '3', title: 'Тайтл', quality: '1080p', mediaType: 'tv' },
    ];
    const item = (entry) => allItems.find(candidate => candidate.provider === entry);
    const lines = isSingle
      ? [
        { line: JSON.stringify({ type: 'provider', provider: providers[0], items: [{ provider: providers[0], providerName: providers[0], sourceId: '9', title: 'Тайтл', quality: '480p', mediaType: 'tv' }] }) },
        { line: JSON.stringify({ type: 'done', response: { items: [{ provider: providers[0], providerName: providers[0], sourceId: '9', title: 'Тайтл', quality: '480p', mediaType: 'tv' }], errors: {} } }) },
      ]
      : [
        { line: JSON.stringify({ type: 'provider', provider: 'kodik', items: [item('kodik')] }), delay: 60 },
        { line: JSON.stringify({ type: 'provider', provider: 'aniliberty', items: [item('aniliberty')] }), delay: 30 },
        { line: JSON.stringify({ type: 'provider', provider: 'animelib', items: [item('animelib')] }), delay: 30 },
        { line: JSON.stringify({ type: 'provider-error', provider: 'anidub', error: 'provider timeout after 20s' }), delay: 30 },
        { line: JSON.stringify({ type: 'provider-error', provider: 'lordfilm', error: '403 blocked by WAF' }), delay: 30 },
        { line: JSON.stringify({ type: 'provider', provider: 'filmix', items: [{ provider: 'filmix', providerName: 'filmix', sourceId: '9', title: 'Тайтл', quality: '480p', mediaType: 'tv' }] }), delay: 60 },
        { line: JSON.stringify({ type: 'done', response: { items: [...allItems, { provider: 'filmix', providerName: 'filmix', sourceId: '9', title: 'Тайтл', quality: '480p', mediaType: 'tv' }], errors: { anidub: 'provider timeout after 20s', lordfilm: '403 blocked by WAF' } } }) },
      ];
    return { ok: true, json: async () => ({ items: [], errors: {} }), body: ndjsonBody(lines) };
  };

  // i18n.js is a side-effect module loaded by plugin/index.js — bootstrap alone
  // does not pull it, so load it explicitly to register the translations.
  await import('../plugin/i18n.js');
  const { bootstrap } = await import('../plugin/app/bootstrap.js');
  const app = bootstrap();
  const { controller, registry } = app;

  const waitFor = async (predicate, attempts = 400) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('condition was not met in time');
  };

  const latest = () => rendered.at(-1)?.layout;
  const findDeep = (node, predicate) => {
    if (!node) return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = findDeep(child, predicate);
        if (hit) return hit;
      }
      return null;
    }
    if (predicate(node)) return node;
    return findDeep(node.childrenList, predicate);
  };
  const resultsGrid = () => {
    const pageContent = latest()?.childrenList?.[0]?.childrenList?.[0];
    return pageContent?.childrenList?.find(item => item.styleValue?.startsWith('online-results-grid')) ?? null;
  };
  const findCard = grid => (grid?.childrenList || [])
    .find(child => String(child.styleValue ?? '').startsWith('online-grid-card'));

  controller.applyRoute({ query: { q: 'Тайтл' } });

  // Mid-flight: the skeleton poster grid renders while the first chunk is on its way.
  await waitFor(() => resultsGrid()?.childrenList?.length > 0);
  assert.ok(
    findDeep(resultsGrid(), node => node.type === 'Skeleton'),
    'skeleton poster cards render during loading',
  );

  // After the chunks land the real card replaces the skeletons: title, meta, adult badge.
  await waitFor(() => findCard(resultsGrid()));
  // Let the streamed chunks settle (mock deliveries have small delays).
  await new Promise(resolve => setTimeout(resolve, 500));
  const card = findCard(resultsGrid());
  assert.ok(findDeep(card, node => String(node.text ?? '') === 'Тайтл'), 'card title rendered');
  assert.ok(
    findDeep(card, node => String(node.text ?? '').includes('1080p')),
    'card meta carries the best quality',
  );
  assert.ok(
    findDeep(card, node => node.styleValue === 'online-badge-adult'),
    'the adult provider is marked on the card',
  );

  // The full-card hit button opens the source (episode panel hand-off).
  const hit = card.childrenList.find(child => child.styleValue === 'online-grid-hit');
  assert.ok(hit, 'expected the full-card hit button');
  hit.click();
  await waitFor(() => presented.length > 0);
  assert.equal(presented[0].title, 'Тайтл');
});
