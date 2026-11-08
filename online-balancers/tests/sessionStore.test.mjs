import assert from 'node:assert/strict';
import test from 'node:test';

import { createSessionStore } from '../plugin/playback/sessionStore.js';

const resolution = { streamUrl: 'https://cdn.test/ep.m3u8', streamType: 'm3u8', voice: 'AniDUB' };

test('resolution cache returns a stored entry and returns a defensive copy', () => {
  const store = createSessionStore();
  assert.equal(store.getResolution('kodik', 'serial-4898', 1, 2), null);

  store.setResolution('kodik', 'serial-4898', 1, 2, resolution);
  const hit = store.getResolution('kodik', 'serial-4898', 1, 2);
  assert.deepEqual(hit, resolution);
  assert.notEqual(hit, resolution);

  hit.streamUrl = 'mutated';
  assert.equal(store.getResolution('kodik', 'serial-4898', 1, 2).streamUrl, 'https://cdn.test/ep.m3u8');
});

test('resolution cache keys by provider, source, season, episode AND voice', () => {
  const store = createSessionStore();
  const anidub = { ...resolution, streamUrl: 'https://cdn.test/anidub.m3u8', voice: 'AniDUB' };
  const anilibria = { ...resolution, streamUrl: 'https://cdn.test/anilibria.m3u8', voice: 'AniLibria' };

  // Online streams bake the dub into the URL — each voice is its own cached stream.
  store.setResolution('aniliberty', 'source-1', 1, 2, anidub, 'AniDUB');
  store.setResolution('aniliberty', 'source-1', 1, 2, anilibria, 'AniLibria');

  assert.deepEqual(store.getResolution('aniliberty', 'source-1', 1, 2, 'AniDUB'), anidub);
  assert.deepEqual(store.getResolution('aniliberty', 'source-1', 1, 2, 'AniLibria'), anilibria);
  // Voice lookup is case-insensitive / whitespace-tolerant.
  assert.deepEqual(store.getResolution('aniliberty', 'source-1', 1, 2, ' anidub '), anidub);
  // No voice given → no hit on a voice-specific entry.
  assert.equal(store.getResolution('aniliberty', 'source-1', 1, 2), null);
  assert.equal(store.getResolution('aniliberty', 'source-1', 1, 2, 'SHIZA'), null);
  // A different source, season or episode is a different stream.
  assert.equal(store.getResolution('aniliberty', 'other-source', 1, 2, 'AniDUB'), null);
  assert.equal(store.getResolution('aniliberty', 'source-1', 1, 3, 'AniDUB'), null);
  assert.equal(store.getResolution('kodik', 'source-1', 1, 2, 'AniDUB'), null);
  assert.equal(store.getResolution(null, 'source-1', 1, 2, 'AniDUB'), null);
});

test('resolution cache entries expire after the TTL', () => {
  const store = createSessionStore();
  const realNow = Date.now;
  try {
    Date.now = () => 1_000_000;
    store.setResolution('kodik', 'serial-4898', 1, 2, resolution);
    assert.ok(store.getResolution('kodik', 'serial-4898', 1, 2));

    // 31 minutes later — past the 30-minute TTL.
    Date.now = () => 1_000_000 + 31 * 60 * 1000;
    assert.equal(store.getResolution('kodik', 'serial-4898', 1, 2), null);
    assert.equal(store.resolutionCount(), 0);
  } finally {
    Date.now = realNow;
  }
});

test('resolution cache is bounded and evicts the oldest entries', () => {
  const store = createSessionStore();
  for (let episode = 1; episode <= 250; episode += 1) {
    store.setResolution('kodik', 'serial-4898', 1, episode, resolution);
  }
  assert.equal(store.resolutionCount(), 200);
  // Episodes 1..50 were evicted, the newest 200 survive.
  assert.equal(store.getResolution('kodik', 'serial-4898', 1, 50), null);
  assert.ok(store.getResolution('kodik', 'serial-4898', 1, 51));
  assert.ok(store.getResolution('kodik', 'serial-4898', 1, 250));
});

test('clear wipes both the active session and the resolution cache', () => {
  const store = createSessionStore();
  store.set('session-1', 'kodik');
  store.setResolution('kodik', 'serial-4898', 1, 2, resolution);
  store.clear();
  assert.equal(store.get(), null);
  assert.equal(store.getResolution('kodik', 'serial-4898', 1, 2), null);
});
