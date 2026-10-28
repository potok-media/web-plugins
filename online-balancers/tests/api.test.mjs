import assert from 'node:assert/strict';
import test from 'node:test';

import { createOnlineBalancersClient, resolveApiBase } from '../plugin/api/onlineBalancersClient.js';

test('API client derives its origin from the served plugin module and forwards provider filters', async () => {
  const calls = [];
  const client = createOnlineBalancersClient({
    apiBase: resolveApiBase('https://api.test/plugin/app/bootstrap.js'),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ items: [], errors: {} }) };
    },
  });

  await client.search({ title: 'Anime' }, ['kodik']);
  assert.equal(calls[0].url, 'https://api.test/api/v1/search');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    query: { title: 'Anime' },
    providers: ['kodik'],
  });
  assert.equal(client.audioUrl('ticket', 'mp4'), 'https://api.test/api/v1/audio/ticket.mp4');
});

test('API client exposes problem details from failed requests', async () => {
  const client = createOnlineBalancersClient({
    apiBase: 'https://api.test',
    fetchImpl: async () => ({
      ok: false,
      status: 502,
      json: async () => ({ detail: 'provider unavailable' }),
    }),
  });

  await assert.rejects(() => client.search({ title: 'Anime' }), /provider unavailable/);
});

test('API client keeps all application operations behind one transport seam', async () => {
  const calls = [];
  const client = createOnlineBalancersClient({
    apiBase: 'https://api.test',
    fetchImpl: async (url, options) => {
      calls.push({ path: new URL(url).pathname, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({}) };
    },
  });

  await client.getEpisodes({ provider: 'kodik', sourceId: '1', query: {} });
  await client.resolvePlayback({ provider: 'kodik', sourceId: '1', query: {} });
  await client.refreshPlayback('session');
  assert.deepEqual(calls, [
    { path: '/api/v1/episodes', body: { provider: 'kodik', sourceId: '1', query: {} } },
    { path: '/api/v1/playback', body: { provider: 'kodik', sourceId: '1', query: {} } },
    { path: '/api/v1/refresh', body: { session: 'session' } },
  ]);
});

test('API client attaches only the explicitly selected provider account', async () => {
  const calls = [];
  const client = createOnlineBalancersClient({
    apiBase: 'https://api.test',
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ items: [], errors: {} }) };
    },
  });

  const account = { provider: 'kinopub', values: { accessToken: 'private-token' } };
  await client.search({ title: 'Movie' }, ['kinopub'], account);
  assert.deepEqual(calls[0], {
    query: { title: 'Movie' },
    providers: ['kinopub'],
    account,
  });
});

test('API client exposes request-local account connection operations', async () => {
  const calls = [];
  const client = createOnlineBalancersClient({
    apiBase: 'https://api.test',
    fetchImpl: async (url, options) => {
      calls.push({ path: new URL(url).pathname, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({}) };
    },
  });

  await client.startKinoPubDevice();
  await client.pollKinoPubDevice('device-code');
  await client.loginRezka({ host: 'https://rezka.ag', login: 'user', password: 'secret' });

  assert.deepEqual(calls, [
    { path: '/api/v1/accounts/kinopub/device/start', body: {} },
    { path: '/api/v1/accounts/kinopub/device/poll', body: { code: 'device-code' } },
    {
      path: '/api/v1/accounts/rezka/login',
      body: { host: 'https://rezka.ag', login: 'user', password: 'secret' },
    },
  ]);
});
