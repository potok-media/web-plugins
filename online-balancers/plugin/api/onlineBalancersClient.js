export function resolveApiBase(baseUri = globalThis.document?.baseURI) {
  if (!baseUri) throw new Error('Online Balancers: plugin base URI is unavailable');
  return new URL('../', baseUri).origin;
}

export function createOnlineBalancersClient({
  apiBase = resolveApiBase(),
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Online Balancers: fetch is unavailable');
  const base = String(apiBase).replace(/\/+$/, '');

  async function post(path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let message = `Online Balancers: HTTP ${response.status}`;
      try {
        const problem = await response.json();
        message = problem.detail || problem.title || message;
      } catch {}
      throw new Error(message);
    }
    return response.json();
  }

  return Object.freeze({
    apiBase: base,
    search(query, providerIds, account = null) {
      return post('/api/v1/search', { query, providers: providerIds, ...(account ? { account } : {}) });
    },
    getEpisodes(selection) {
      return post('/api/v1/episodes', selection);
    },
    resolvePlayback(selection) {
      return post('/api/v1/playback', selection);
    },
    refreshPlayback(session, account = null) {
      return post('/api/v1/refresh', { session, ...(account ? { account } : {}) });
    },
    startKinoPubDevice() {
      return post('/api/v1/accounts/kinopub/device/start', {});
    },
    pollKinoPubDevice(code) {
      return post('/api/v1/accounts/kinopub/device/poll', { code });
    },
    loginRezka({ host, login, password }) {
      return post('/api/v1/accounts/rezka/login', { host, login, password });
    },
    audioUrl(session, streamType = 'm3u8') {
      const extension = streamType === 'mp4' ? 'mp4' : 'm3u8';
      return `${base}/api/v1/audio/${encodeURIComponent(session)}.${extension}`;
    },
  });
}
