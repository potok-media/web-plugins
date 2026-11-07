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

  // Streaming search: the backend answers with NDJSON chunks — one per finished provider
  // ("provider" / "provider-error") and a final "done" chunk with the full response.
  // Each provider chunk is forwarded to onProviderResult as it arrives; the promise
  // resolves with the done payload and rejects if the stream ends without it.
  async function streamSearch(path, body, onProviderResult) {
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
    const reader = response.body?.getReader?.();
    if (!reader) return response.json();
    const decoder = new TextDecoder();
    let buffer = '';
    return new Promise((resolve, reject) => {
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) {
          reject(new Error('Online Balancers: search stream ended without a done chunk'));
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
          if (!line) continue;
          const chunk = JSON.parse(line);
          if (chunk.type === 'done') {
            resolve(chunk.response);
            return;
          }
          onProviderResult?.(chunk);
        }
        await pump();
      };
      pump().catch(reject);
    });
  }

  return Object.freeze({
    apiBase: base,
    search(query, providerIds, onProviderResult = null, accounts = null) {
      return streamSearch('/api/v1/search', { query, providers: providerIds, ...(accounts ? { accounts } : {}) }, onProviderResult);
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
    // Filmix has no activation-status endpoint: start returns a code pair, and the
    // account is stored when the user confirms activation (poll).
    startFilmixDevice() {
      return post('/api/v1/accounts/filmix/device/start', {});
    },
    pollFilmixDevice(code) {
      return post('/api/v1/accounts/filmix/device/poll', { code });
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
