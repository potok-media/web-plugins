import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlaybackPayload, withAudioIndex } from '../plugin/playback/playbackMapper.js';
import { createPlaybackService } from '../plugin/playback/playbackController.js';
import { createSessionStore } from '../plugin/playback/sessionStore.js';

test('playback mapper keeps media tracking fields and exposes every resolved audio on the item', () => {
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

  // R3: NO top-level content fields — playlist[] (single synthesized item here) carries it all.
  assert.equal('streamUrl' in payload, false);
  assert.equal('streamType' in payload, false);
  assert.equal('audios' in payload, false);
  assert.equal('season' in payload, false);
  assert.equal('episode' in payload, false);
  assert.equal('headers' in payload, false);
  assert.equal('session' in payload, false);
  assert.equal(payload.title, 'Anime');
  assert.equal(payload.id, 42);
  assert.equal(payload.workId, 'work-42');
  assert.equal(payload.entryId, 'entry-2');
  assert.equal(payload.episodeId, 'episode-3');

  const item = payload.playlist[payload.playlistIndex];
  // The streamUrl is the resolved URL verbatim — no `?audio=N` suffix (the backend bakes the
  // voice into the URL; the plugin's audio-param convention is dead).
  assert.equal(item.streamUrl, 'https://api.test/b.m3u8');
  assert.equal(item.streamType, 'm3u8');
  assert.equal(item.season, 2);
  assert.equal(item.episode, 3);
  // No candidates were provided, so the no-candidates fallback list still derives its
  // `?audio=N` urls from the resolved responses via withAudioIndex/resolvedAudioUrl.
  assert.deepEqual(item.audios, [
    { name: 'Dub A', url: 'https://api.test/a.m3u8?audio=0' },
    { name: 'Dub B', url: 'https://api.test/b.m3u8?audio=1' },
  ]);
  assert.equal(withAudioIndex('https://api.test/video?token=x', 2), 'https://api.test/video?token=x&audio=2');
});

test('single-candidate resolution still exposes the full voice list from episode candidates', () => {
  const client = { audioUrl: (session, type) => `https://api.test/audio/${session}.${type}` };
  const resolved = [
    { candidateIndex: 1, target: { voice: 'Dub B' }, response: { streamUrl: 'https://api.test/b.m3u8', streamType: 'm3u8', session: 'b' } },
  ];
  const payload = createPlaybackPayload({
    client,
    primary: resolved[0],
    primaryIndex: 0,
    resolved,
    candidates: [
      { id: 'a', voice: 'Dub A', name: 'Dub A' },
      { id: 'b', voice: 'Dub B', name: 'Dub B' },
    ],
    stream: { title: 'Anime', mediaType: 'tv' },
    selected: { season: 1, episode: 1 },
    context: { title: 'Anime', type: 'tv', tmdbId: 42 },
    pluginId: 'plugin',
    translate: key => key,
  });

  // Only Dub B was resolved upstream, but every voice variant is listed on the current item.
  const item = payload.playlist[payload.playlistIndex];
  assert.equal(item.streamUrl, 'https://api.test/b.m3u8');
  assert.deepEqual(item.audios, [
    { name: 'Dub A', label: 'Dub A', voice: 'Dub A', providerId: null, sourceId: null, query: null, url: '' },
    { name: 'Dub B', label: 'Dub B', voice: 'Dub B', providerId: null, sourceId: null, query: null, url: '' },
  ]);
});

test('playlist items carry their voice variants; the active item owns the full candidate menu', () => {
  const client = { audioUrl: () => '' };
  const resolved = [
    { candidateIndex: 0, target: { voice: 'Dub A' }, response: { streamUrl: 'https://api.test/a.m3u8', streamType: 'm3u8' } },
  ];
  const payload = createPlaybackPayload({
    client,
    primary: resolved[0],
    primaryIndex: 0,
    resolved,
    stream: { title: 'Anime', mediaType: 'tv' },
    selected: { season: 1, episode: 1 },
    context: { title: 'Anime', type: 'tv', tmdbId: 42 },
    pluginId: 'plugin',
    translate: key => key,
    episodes: [
      {
        id: '1:1', season: 1, episode: 1, title: 'Ep 1',
        audios: [{ voice: 'Dub A' }, { voice: 'Dub B' }],
      },
      {
        id: '1:2', season: 1, episode: 2, title: 'Ep 2',
        audios: [{ voice: 'Dub A' }],
      },
    ],
    activeEpisodeId: '1:1',
    resolvedUrlMap: new Map([
      ['1:1', { streamUrl: 'https://api.test/ep1.m3u8' }],
      ['1:2', { streamUrl: 'https://api.test/ep2.m3u8' }],
    ]),
  });

  assert.equal(payload.playlistIndex, 0);
  // The active item's own streamUrl is the resolved per-episode base url, verbatim, and it owns
  // the resolved voice candidate (ready url — the host switches by a local swap, R1).
  assert.equal(payload.playlist[0].streamUrl, 'https://api.test/ep1.m3u8');
  assert.deepEqual(payload.playlist[0].audios, [
    { name: 'Dub A', url: 'https://api.test/a.m3u8?audio=0' },
  ]);
  // Other items keep their per-episode voice lists.
  assert.equal(payload.playlist[1].streamUrl, 'https://api.test/ep2.m3u8');
  assert.deepEqual(payload.playlist[1].audios, [
    { name: 'Dub A', label: null, voice: 'Dub A', providerId: null, sourceId: null, query: null, url: '' },
  ]);
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

test('playback payload leaves complete: window episodes carry ready streamUrls and the voice-keyed cache', async () => {
  const sessionStore = createSessionStore();
  const client = {
    resolvePlayback: async (request) => ({
      streamUrl: `https://cdn.test/ep${request.episode}.m3u8`,
      streamType: 'm3u8',
      voice: request.voice,
    }),
  };
  const service = createPlaybackService({
    client,
    episodeService: { fetchEpisodes: async () => ({ episodes: [] }) },
    sessionStore,
    pluginId: 'potok-online-balancers',
    translate: key => key,
    playVideo: () => {},
  });

  const episodes = Array.from({ length: 10 }, (_, idx) => ({
    id: `1:${idx + 1}`,
    season: 1,
    episode: idx + 1,
    voice: 'AniDUB',
    providerId: 'aniliberty',
    sourceId: 'src-1',
    query: { tmdbId: 1 },
  }));

  // Blocking contract: the payload returns with the window ALREADY resolved.
  const payload = await service.resolvePlayback(
    { id: 'stream-1', title: 'Anime', mediaType: 'tv', providerId: 'aniliberty', sourceId: 'src-1', query: { tmdbId: 1 } },
    { id: '1:5', season: 1, episode: 5, voice: 'AniDUB', providerId: 'aniliberty', sourceId: 'src-1' },
    { type: 'tv', title: 'Anime', tmdbId: 1 },
    episodes,
    '1:5',
  );

  assert.equal('streamUrl' in payload, false);
  assert.equal(payload.playlist[payload.playlistIndex].streamUrl, 'https://cdn.test/ep5.m3u8');
  // Window: anchor ep5 (index 4) → indices 1..9 (eps 2..10). The anchor item itself
  // carries the primary URL; every in-window item has a ready streamUrl; ep1 is outside.
  assert.ok(!payload.playlist[0].streamUrl);
  assert.equal(payload.playlist[1].streamUrl, 'https://cdn.test/ep2.m3u8');
  assert.equal(payload.playlist[4].streamUrl, 'https://cdn.test/ep5.m3u8');
  assert.equal(payload.playlist[9].streamUrl, 'https://cdn.test/ep10.m3u8');

  // The primary itself cached ep5; the window cached the rest.
  for (const ep of [2, 3, 5, 6, 7, 8, 9, 10]) {
    const hit = sessionStore.getResolution('aniliberty', 'src-1', 1, ep, 'AniDUB');
    assert.ok(hit, `episode ${ep} should be cached`);
    assert.equal(hit.streamUrl, `https://cdn.test/ep${ep}.m3u8`);
  }
  // Episode 1 is outside the window — it was never requested.
  assert.equal(sessionStore.getResolution('aniliberty', 'src-1', 1, 1, 'AniDUB'), null);
  // A different voice does not see the AniDUB cache.
  assert.equal(sessionStore.getResolution('aniliberty', 'src-1', 1, 5, 'AniLibria'), null);
});
