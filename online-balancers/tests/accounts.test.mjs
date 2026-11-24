import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountVault, providerAccountEnvelope } from '../plugin/accounts/accountVault.js';

function memoryStorage() {
  const values = new Map();
  return {
    values,
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
}

test('account vault persists provider credentials in plugin-local storage', async () => {
  const storage = memoryStorage();
  const first = createAccountVault(storage);
  await first.saveAccount('kinopub', { accessToken: 'token', label: 'My account' });

  const second = createAccountVault(storage);
  assert.deepEqual(await second.getAccount('kinopub'), {
    accessToken: 'token',
    label: 'My account',
  });
  assert.match(storage.values.get('provider-accounts'), /"version":1/);

  await second.removeAccount('kinopub');
  assert.equal(await first.getAccount('kinopub'), null);
});

test('account vault never persists passwords and returns defensive copies', async () => {
  const vault = createAccountVault(memoryStorage());
  await assert.rejects(
    () => vault.saveAccount('rezka', { password: 'must-not-be-written' }),
    /Passwords must never be persisted/,
  );

  const saved = await vault.saveAccount('rezka', { cookie: 'dle_user_id=1' });
  saved.cookie = 'changed';
  assert.deepEqual(await vault.getAccount('rezka'), { cookie: 'dle_user_id=1' });
  assert.deepEqual(providerAccountEnvelope('rezka', await vault.getAccount('rezka')), {
    provider: 'rezka',
    values: { cookie: 'dle_user_id=1' },
  });
});

test('account vault refreshes an expiring KinoPub token and persists the rotated credentials', async () => {
  const storage = memoryStorage();
  const refreshes = [];
  const vault = createAccountVault(storage, {
    now: () => 1_000_000,
    async refreshAccount(providerId, account) {
      refreshes.push({ providerId, account });
      return {
        accessToken: 'fresh-access',
        refreshToken: 'fresh-refresh',
        expiresAt: '2000000',
      };
    },
  });
  await vault.saveAccount('kinopub', {
    accessToken: 'stale-access',
    refreshToken: 'stale-refresh',
    expiresAt: '1000500',
  });

  const account = await vault.getAccount('kinopub');

  assert.deepEqual(refreshes, [{
    providerId: 'kinopub',
    account: {
      accessToken: 'stale-access',
      refreshToken: 'stale-refresh',
      expiresAt: '1000500',
    },
  }]);
  assert.deepEqual(account, {
    accessToken: 'fresh-access',
    refreshToken: 'fresh-refresh',
    expiresAt: '2000000',
  });
  assert.deepEqual(await createAccountVault(storage).getAccount('kinopub'), account);
});

test('account vault coalesces concurrent KinoPub refreshes into one request', async () => {
  const storage = memoryStorage();
  let releaseRefresh;
  let refreshCount = 0;
  const vault = createAccountVault(storage, {
    now: () => 1_000_000,
    refreshAccount() {
      refreshCount += 1;
      return new Promise(resolve => {
        releaseRefresh = () => resolve({
          accessToken: 'fresh-access',
          refreshToken: 'fresh-refresh',
          expiresAt: '2000000',
        });
      });
    },
  });
  await vault.saveAccount('kinopub', {
    accessToken: 'stale-access',
    refreshToken: 'stale-refresh',
    expiresAt: '1000500',
  });

  const first = vault.getAccount('kinopub');
  const second = vault.getAccount('kinopub');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshCount, 1);
  releaseRefresh();

  assert.deepEqual(await first, await second);
});

test('legacy KinoPub accounts without refresh metadata remain readable', async () => {
  const vault = createAccountVault(memoryStorage(), {
    async refreshAccount() {
      throw new Error('legacy account must not attempt refresh');
    },
  });
  await vault.saveAccount('kinopub', { accessToken: 'legacy-access' });

  assert.deepEqual(await vault.getAccount('kinopub'), { accessToken: 'legacy-access' });
});

test('a failed KinoPub refresh falls back to the stored token without breaking other providers', async () => {
  let refreshCount = 0;
  const vault = createAccountVault(memoryStorage(), {
    now: () => 1_000_000,
    async refreshAccount() {
      refreshCount += 1;
      throw new Error('refresh unavailable');
    },
  });
  const stored = {
    accessToken: 'stale-access',
    refreshToken: 'stale-refresh',
    expiresAt: '1000500',
  };
  await vault.saveAccount('kinopub', stored);

  assert.deepEqual(await vault.getAccount('kinopub'), stored);
  assert.deepEqual(await vault.getAccount('kinopub'), stored);
  assert.equal(refreshCount, 1);
});
