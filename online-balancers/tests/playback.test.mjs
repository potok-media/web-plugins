import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlaybackPayload, withAudioIndex } from '../plugin/playback/playbackMapper.js';
import { createSessionStore } from '../plugin/playback/sessionStore.js';

test('playback mapper keeps media tracking fields and exposes every resolved audio', () => {
  const client = { audioUrl: (session, type) => `https://api.test/audio/${session}.${type}` };
  const resolved = [
    { target: { voice: 'Dub A' }, response: { streamUrl: 'https://api.test/a.m3u8', streamType: 'm3u8', session: 'a' } },
    { target: { voice: 'Dub B' }, response: { streamUrl: 'https://api.test/b.m3u8', streamType: 'm3u8', session: 'b' } },
  ];
  const payload = createPlaybackPayload({
    client,
    primary: resolved[1],
    primaryIndex: 1,
    resolved,
    stream: { title: 'Anime', mediaType: 'tv' },
    selected: {
      season: 2,
      episode: 3,
      workId: 'work-42',
      entryId: 'entry-2',
      episodeId: 'episode-3',
    },
    context: { title: 'Anime', type: 'tv', tmdbId: 42 },
    pluginId: 'plugin',
    translate: key => key,
  });

  assert.equal(payload.streamUrl, 'https://api.test/b.m3u8?audio=1');
  assert.equal(payload.streamType, 'm3u8');
  assert.equal(payload.title, 'Anime — S2E3');
  assert.equal(payload.id, 42);
  assert.equal(payload.workId, 'work-42');
  assert.equal(payload.entryId, 'entry-2');
  assert.equal(payload.episodeId, 'episode-3');
  assert.equal('session' in payload, false);
  assert.deepEqual(payload.audios, [
    { name: 'Dub A', url: 'https://api.test/a.m3u8?audio=0' },
    { name: 'Dub B', url: 'https://api.test/b.m3u8?audio=1' },
  ]);
  assert.equal(withAudioIndex('https://api.test/video?token=x', 2), 'https://api.test/video?token=x&audio=2');
});

test('session store owns refresh state independently from page state', () => {
  const store = createSessionStore();
  assert.equal(store.get(), null);
  store.set('signed-session');
  assert.deepEqual(store.get(), { session: 'signed-session', providerId: null });
  store.set('paid-session', 'kinopub');
  assert.deepEqual(store.get(), { session: 'paid-session', providerId: 'kinopub' });
  store.clear();
  assert.equal(store.get(), null);
});
