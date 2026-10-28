import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountVault } from '../plugin/accounts/accountVault.js';
import { createAppController } from '../plugin/app/controller.js';
import { createPageState } from '../plugin/app/state.js';

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

function fixture(client = {}) {
  const values = new Map();
  const vault = createAccountVault({
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
  });
  const state = createPageState();
  const controller = createAppController({
    state,
    accountVault: vault,
    client,
    registry: {
      accounts: [
        { id: 'alloha' },
        { id: 'kinopub' },
        { id: 'rezka' },
      ],
    },
    searchService: { async search() { return { items: [], errors: {} }; } },
    episodeService: {},
    playbackService: {},
    ui: { showHUD() {} },
    translate(key) { return key; },
  });
  controller.setRenderer(() => {});
  return { state, controller, vault };
}

test('Rezka password is request-local and only the returned session persists', async () => {
  const requests = [];
  const { state, controller, vault } = fixture({
    async loginRezka(credentials) {
      requests.push({ ...credentials });
      return {
        account: {
          provider: 'rezka',
          values: { host: credentials.host, cookie: 'dle_user_id=1; dle_hash=private', label: credentials.login },
        },
      };
    },
  });

  controller.actions.openAccountProvider('rezka');
  controller.actions.setAccountField('login', 'viewer');
  controller.actions.setAccountField('password', 'one-use-password');
  controller.actions.loginRezka();
  await tick();
  await tick();

  assert.deepEqual(requests, [{ host: 'https://rezka.ag', login: 'viewer', password: 'one-use-password' }]);
  assert.deepEqual(await vault.getAccount('rezka'), {
    host: 'https://rezka.ag',
    cookie: 'dle_user_id=1; dle_hash=private',
    label: 'viewer',
  });
  assert.equal(state.accountDraft.password, '');
});

test('KinoWatch device flow persists only the access token returned by the backend', async () => {
  const { state, controller, vault } = fixture({
    async startKinoPubDevice() {
      return { code: 'opaque-device-code', userCode: 'ABCD', verificationUri: 'https://kino.watch/device' };
    },
    async pollKinoPubDevice(code) {
      assert.equal(code, 'opaque-device-code');
      return { account: { provider: 'kinopub', values: { accessToken: 'access-token' } } };
    },
  });

  controller.actions.openAccountProvider('kinopub');
  controller.actions.startKinoPub();
  await tick();
  assert.equal(state.kinoPubDevice.userCode, 'ABCD');
  assert.equal(state.kinoPubDevice.verificationUri, 'https://kino.watch/device');

  controller.actions.pollKinoPub();
  await tick();
  await tick();
  assert.deepEqual(await vault.getAccount('kinopub'), { accessToken: 'access-token' });
});

test('page state receives connection metadata but never persisted account secrets', async () => {
  const { state, controller, vault } = fixture();
  await vault.saveAccount('rezka', {
    host: 'https://rezka.ag',
    cookie: 'dle_hash=private',
    label: 'viewer',
  });
  await vault.saveAccount('alloha', {
    apiToken: 'private-api',
    secretToken: 'private-secret',
  });

  await controller.loadAccounts();

  assert.deepEqual(state.accounts, {
    rezka: { connected: true, label: 'viewer', host: 'https://rezka.ag' },
    alloha: { connected: true, label: '' },
  });
  assert.doesNotMatch(JSON.stringify(state.accounts), /private|cookie|token/i);
});
