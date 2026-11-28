import assert from 'node:assert/strict';
import test from 'node:test';

import { PotokSDK, registrations } from './fixtures/sdk.mjs';

test('plugin starts against the current Core SDK surface', async () => {
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 1;
  PotokSDK.http.request = async () => ({ status: 503, data: null });

  try {
    await import('../index.js');
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    globalThis.setInterval = originalSetInterval;
  }

  assert.equal(registrations.streams.length, 1);
  const source = registrations.streams[0];
  for (const method of [
    'search',
    'getEpisodes',
    'getSeasonsMetadata',
    'saveSeasonOverride',
    'clearSeasonOverride',
    'saveFileOverride',
    'clearFileOverride',
    'saveEpisodeBinding',
    'getPlaybackInfo',
    'getPlaybackMetadata',
  ]) {
    assert.equal(typeof source[method], 'function', `${method} must be registered`);
  }
  assert.deepEqual(
    registrations.slots.map((slot) => slot.id).sort(),
    ['torrents-media-actions', 'torrents-search-source', 'torrents-sidebar-status'],
  );
});
