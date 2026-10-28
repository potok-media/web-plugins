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
