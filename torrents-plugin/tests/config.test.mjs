import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PotokSDK } from 'potok-sdk';
import { resolveJacredUrl } from '../utils/config.js';

test('manifest exposes the complete JacRed configuration contract', async () => {
  const manifest = JSON.parse(await readFile(
    new URL('../manifest.json', import.meta.url),
    'utf8',
  ));

  assert.ok(manifest.permissions.includes('custom-css'));
  assert.equal(manifest.config.searchSource.default, 'jacred');
  assert.equal(manifest.config.searchSource.layoutRow, 'search-source');
  assert.equal(manifest.config.jacredURL.type, 'string');
  assert.equal(manifest.config.jacredURL.default, 'https://jacred.stream');
  assert.equal(manifest.config.jacredURL.layoutRow, 'search-source');
  assert.equal(manifest.config.searchEngineURL.default, '');
  assert.equal(manifest.config.searchEngineURL.layoutRow, 'search-source');
  assert.equal(manifest.config.jacredApiKey.type, 'string');
  assert.equal(manifest.config.jacredApiKey.default, '');
});

test('host CSS keeps the source and active address inline and makes the JacRed key conditional', async () => {
  const cssModule = await readFile(new URL('../settings/styles.js', import.meta.url), 'utf8');

  assert.match(cssModule, /#config-potok-torrents-searchSource/);
  assert.match(cssModule, /#config-potok-torrents-jacredURL/);
  assert.match(cssModule, /#config-potok-torrents-searchEngineURL/);
  assert.match(cssModule, /#config-potok-torrents-jacredApiKey/);
  assert.match(cssModule, /option\[value="potok"\]:checked/);
  assert.match(cssModule, /@media \(max-width: 720px\)/);
});

test('legacy jacredUrl storage is migrated to canonical jacredURL', async () => {
  const originalConfig = PotokSDK.runtime.context.config;
  const originalStorage = PotokSDK.storage.local;
  const values = new Map([['jacredUrl', 'jacred.local/api/']]);

  PotokSDK.runtime.context.config = {};
  PotokSDK.storage.local = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => values.set(key, value),
    removeItem: async (key) => values.delete(key),
  };

  try {
    assert.equal(await resolveJacredUrl(), 'http://jacred.local/api');
    assert.equal(values.get('jacredURL'), 'jacred.local/api/');
    assert.equal(values.has('jacredUrl'), false);
  } finally {
    PotokSDK.runtime.context.config = originalConfig;
    PotokSDK.storage.local = originalStorage;
  }
});
