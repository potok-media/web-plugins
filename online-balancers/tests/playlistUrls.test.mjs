import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeEpisodeVariants } from '../plugin/episodes/mergeVariants.js';
import { createPlaybackService } from '../plugin/playback/playbackController.js';
import { createSessionStore } from '../plugin/playback/sessionStore.js';

const pseudoUrl = 'online-balancers://kodik/serial-4898';

const kodikStream = {
  id: 'kodik:serial-4898',
  title: 'Serial',
  provider: 'Kodik',
  providerId: 'kodik',
  sourceId: 'serial-4898',
  query: { type: 'tv', title: 'Serial', year: 2020 },
  quality: '720p',
  url: pseudoUrl,
  streamUrl: pseudoUrl,
};

test('a host-forwarded episode carrying the owning PLUGIN id in providerId resolves via the stream slug', async () => {
  let seenProvider = null;
  const client = {
    async resolvePlayback(selection) {
      seenProvider = selection.provider;
      return { streamUrl: 'https://cdn.test/s1e1.m3u8', streamType: 'm3u8' };
    },
  };
  const episodeService = { fetchEpisodes: async () => ({ episodes: [] }) };
  const service = createPlaybackService({
    client,
    episodeService,
    sessionStore: createSessionStore(),
    pluginId: 'potok-online-balancers',
    translate: key => key,
    playVideo: () => {},
  });

  // The web host addresses the sandbox with the plugin id and historically echoed it back in
  // episode.providerId — the plugin must NOT treat its own id as a balancer slug.
  await service.resolvePlayback(
    kodikStream,
    { id: '1:1', season: 1, episode: 1, providerId: 'potok-online-balancers', voice: 'Dub A' },
    { type: 'tv', title: 'Serial', tmdbId: 1 },
    [],
    '1:1',
  );

  assert.equal(seenProvider, 'kodik');
});

test('merged episodes never inherit the stream pseudo-url as a playable link', () => {
  const result = {
    episodes: [{
      id: 'ep-1',
      number: 1,
      season: 1,
      title: 'Episode 1',
      url: '',
      audios: [],
    }],
  };
  const merged = mergeEpisodeVariants([{ stream: kodikStream, result }]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].url, '');
  assert.equal(merged[0].audios[0].url, '');
});

test('playback payload resolves playlist episodes that only carry a pseudo streamUrl', async () => {
  const streamHeaders = { Referer: 'https://kodik.cc/', 'X-Token': 'abc' };
  const client = {
    async resolvePlayback(selection) {
      return {
        streamUrl: `https://cdn.test/s${selection.season}e${selection.episode}.m3u8`,
        streamType: 'm3u8',
        headers: streamHeaders,
      };
    },
  };
  const episodeService = { fetchEpisodes: async () => ({ episodes: [] }) };
  const service = createPlaybackService({
    client,
    episodeService,
    sessionStore: createSessionStore(),
    pluginId: 'online-balancers',
    translate: key => key,
    playVideo: () => {},
  });

  const episode = {
    id: '1:1',
    season: 1,
    episode: 1,
    providerId: 'kodik',
    sourceId: 'serial-4898',
    query: kodikStream.query,
  };
  const episodes = [
    episode,
    { id: '1:2', season: 1, episode: 2, providerId: 'kodik', sourceId: 'serial-4898', query: kodikStream.query, url: pseudoUrl, streamUrl: pseudoUrl },
    { id: '1:3', season: 1, episode: 3, providerId: 'kodik', sourceId: 'serial-4898', query: kodikStream.query, streamUrl: 'https://cdn.test/direct.m3u8' },
  ];

  const payload = await service.resolvePlayback(
    kodikStream,
    episode,
    { type: 'tv', title: 'Serial', tmdbId: 1 },
    episodes,
    '1:1',
  );

  // The primary streamUrl is used verbatim — the backend bakes the voice into the URL and
  // no `?audio=N` selector is appended.
  assert.equal(payload.streamUrl, 'https://cdn.test/s1e1.m3u8');
  assert.deepEqual(payload.headers, streamHeaders);
  assert.equal(payload.playlist.length, 3);
  // The window resolves in the background: playlist items keep their own handles until the
  // cache lands — navigation re-resolves and hits the window cache.
  assert.equal(payload.playlist[0].streamUrl, undefined);
  assert.equal(payload.playlist[1].streamUrl, pseudoUrl);
  assert.equal(payload.playlist[2].streamUrl, 'https://cdn.test/direct.m3u8');
  assert.deepEqual(payload.sourceStream.query, kodikStream.query);

  await new Promise(resolve => setTimeout(resolve, 0));
  const replay = await service.resolvePlayback(
    kodikStream,
    episodes[1],
    { type: 'tv', title: 'Serial', tmdbId: 1 },
    episodes,
    '1:2',
  );
  assert.equal(replay.streamUrl, 'https://cdn.test/s1e2.m3u8');
  assert.deepEqual(replay.headers, streamHeaders);
});

test('a multi-voice episode resolves one upstream stream but lists every voice', async () => {
  let playbackCalls = 0;
  const client = {
    async resolvePlayback(selection) {
      playbackCalls += 1;
      return { streamUrl: `https://cdn.test/s${selection.season}e${selection.episode}.m3u8`, streamType: 'm3u8' };
    },
  };
  const episodeService = { fetchEpisodes: async () => ({ episodes: [] }) };
  const service = createPlaybackService({
    client,
    episodeService,
    sessionStore: createSessionStore(),
    pluginId: 'online-balancers',
    translate: key => key,
    playVideo: () => {},
  });

  const episode = {
    id: '1:1',
    season: 1,
    episode: 1,
    providerId: 'kodik',
    sourceId: 'serial-4898',
    query: kodikStream.query,
    selectedAudioId: 'kodik:1:1:1',
    audios: [
      { id: 'kodik:1:1:0', voice: 'Dub A', name: 'Dub A' },
      { id: 'kodik:1:1:1', voice: 'Dub B', name: 'Dub B' },
    ],
  };

  const payload = await service.resolvePlayback(
    kodikStream,
    episode,
    { type: 'tv', title: 'Serial', tmdbId: 1 },
    [episode],
    '1:1',
  );

  // One upstream resolution total — the "million requests" guard stays in place.
  assert.equal(playbackCalls, 1);
  // The resolved streamUrl is used verbatim (no `?audio=N`); every voice is still listed, but
  // entries carry plain names and blank urls — switching a voice re-resolves upstream through
  // the candidate's own provider instead of swapping a fabricated audio-param link.
  assert.equal(payload.streamUrl, 'https://cdn.test/s1e1.m3u8');
  assert.deepEqual(payload.audios, [
    { name: 'Dub A', label: 'Dub A', voice: 'Dub A', providerId: null, sourceId: null, query: null, url: '' },
    { name: 'Dub B', label: 'Dub B', voice: 'Dub B', providerId: null, sourceId: null, query: null, url: '' },
  ]);
});

test('a host-forwarded episode without audio ids keeps its voice via name matching', async () => {
  let playbackCalls = 0;
  const client = {
    async resolvePlayback(selection) {
      playbackCalls += 1;
      return { streamUrl: `https://cdn.test/s${selection.season}e${selection.episode}.m3u8`, streamType: 'm3u8' };
    },
  };
  const episodeService = { fetchEpisodes: async () => ({ episodes: [] }) };
  const service = createPlaybackService({
    client,
    episodeService,
    sessionStore: createSessionStore(),
    pluginId: 'online-balancers',
    translate: key => key,
    playVideo: () => {},
  });

  // Shape the host sends back through STREAM_SOURCE_GET_PLAYBACK_INFO: audio ids and
  // selectedAudioId are stripped, only names and the item voice survive.
  const episode = {
    id: '1:1',
    season: 1,
    episode: 1,
    providerId: 'kodik',
    sourceId: 'serial-4898',
    query: kodikStream.query,
    voice: 'Dub B',
    audios: [
      { name: 'Dub A', url: '' },
      { name: 'Dub B', url: '' },
    ],
  };

  const payload = await service.resolvePlayback(
    kodikStream,
    episode,
    { type: 'tv', title: 'Serial', tmdbId: 1 },
    [episode],
    '1:1',
  );

  assert.equal(playbackCalls, 1);
  // The voice was matched by NAME (audio ids were stripped) — the resolved candidate drives
  // the verbatim streamUrl and payload.voice. The full display name is the canonical `name`
  // (here the fixtures' names ARE the full labels); the plain voice label survives separately
  // for matching, and urls stay blank so any switch re-resolves upstream.
  assert.equal(payload.voice, 'Dub B');
  assert.equal(payload.streamUrl, 'https://cdn.test/s1e1.m3u8');
  assert.deepEqual(payload.audios.map(audio => audio.label), ['Dub A', 'Dub B']);
  assert.deepEqual(payload.audios.map(audio => audio.name), ['Dub A', 'Dub B']);
  assert.deepEqual(payload.audios.map(audio => audio.voice), [null, null]);
  assert.ok(payload.audios.every(audio => audio.url === ''));
});


test('resolution cache serves repeat episode switches without extra API calls', async () => {
  let playbackCalls = 0;
  const client = {
    async resolvePlayback(selection) {
      playbackCalls += 1;
      return { streamUrl: `https://cdn.test/s${selection.season}e${selection.episode}.m3u8`, streamType: 'm3u8' };
    },
  };
  const episodeService = { fetchEpisodes: async () => ({ episodes: [] }) };
  const sessionStore = createSessionStore();
  const service = createPlaybackService({
    client,
    episodeService,
    sessionStore,
    pluginId: 'online-balancers',
    translate: key => key,
    playVideo: () => {},
  });

  const stream = kodikStream;
  const episode = { id: '1:1', season: 1, episode: 1, providerId: 'kodik', sourceId: 'serial-4898', query: stream.query };

  await service.resolvePlayback(stream, episode, { type: 'tv', title: 'Serial' });
  await service.resolvePlayback(stream, episode, { type: 'tv', title: 'Serial' });
  assert.equal(playbackCalls, 1);

  // A DIFFERENT voice is a different baked-in stream — it must resolve again (voice-keyed cache).
  await service.resolvePlayback(stream, { ...episode, voice: 'SHIZA' }, { type: 'tv', title: 'Serial' });
  assert.equal(playbackCalls, 2);
  // Re-requesting that same voice hits the cache.
  await service.resolvePlayback(stream, { ...episode, voice: 'SHIZA' }, { type: 'tv', title: 'Serial' });
  assert.equal(playbackCalls, 2);

  // A different source is a different stream and must resolve again.
  await service.resolvePlayback(stream, { ...episode, sourceId: 'serial-9999' }, { type: 'tv', title: 'Serial' });
  assert.equal(playbackCalls, 3);
});

test('an explicitly requested voice wins over selectedAudioId and resolves exactly one candidate', async () => {
  const calls = [];
  const client = {
    async resolvePlayback(selection) {
      calls.push(selection);
      return { streamUrl: `https://cdn.test/s${selection.season}e${selection.episode}.m3u8`, streamType: 'm3u8' };
    },
  };
  const episodeService = { fetchEpisodes: async () => ({ episodes: [] }) };
  const service = createPlaybackService({
    client,
    episodeService,
    sessionStore: createSessionStore(),
    pluginId: 'online-balancers',
    translate: key => key,
    playVideo: () => {},
  });

  const episode = {
    id: '1:1',
    season: 1,
    episode: 1,
    providerId: 'kodik',
    sourceId: 'serial-4898',
    query: kodikStream.query,
    selectedAudioId: 'kodik:1:1:0',
    // The host sends the voice the user wants to switch to — case-insensitive match.
    voice: 'анилибрия',
    audios: [
      { id: 'kodik:1:1:0', voice: 'Кодик', name: 'Кодик' },
      { id: 'kodik:1:1:1', voice: 'Анилибрия', name: 'Анилибрия' },
      { id: 'kodik:1:1:2', voice: 'SHIZA', name: 'SHIZA' },
    ],
  };

  const payload = await service.resolvePlayback(
    kodikStream,
    episode,
    { type: 'tv', title: 'Serial', tmdbId: 1 },
    [episode],
    '1:1',
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].voice, 'Анилибрия');
  assert.equal(payload.voice, 'Анилибрия');
  // The streamUrl is the resolved URL verbatim — the matched candidate is resolved through
  // its own provider (calls[0]), not selected via a `?audio=N` suffix.
  assert.equal(payload.streamUrl, 'https://cdn.test/s1e1.m3u8');
  assert.deepEqual(payload.audios.map(audio => audio.name), ['Кодик', 'Анилибрия', 'SHIZA']);
  assert.ok(payload.audios.every(audio => audio.url === ''));
});

test('a requested voice that matches no candidate rejects without any upstream resolution', async () => {
  const calls = [];
  const client = {
    async resolvePlayback(selection) {
      calls.push(selection);
      return { streamUrl: 'https://cdn.test/s1e1.m3u8', streamType: 'm3u8' };
    },
  };
  const episodeService = { fetchEpisodes: async () => ({ episodes: [] }) };
  const service = createPlaybackService({
    client,
    episodeService,
    sessionStore: createSessionStore(),
    pluginId: 'online-balancers',
    translate: (key, values) => (values?.voice ? `${key}:${values.voice}` : key),
    playVideo: () => {},
  });

  const episode = {
    id: '1:1',
    season: 1,
    episode: 1,
    providerId: 'kodik',
    sourceId: 'serial-4898',
    query: kodikStream.query,
    selectedAudioId: 'kodik:1:1:0',
    voice: 'Несуществующая озвучка',
    audios: [
      { id: 'kodik:1:1:0', voice: 'Кодик', name: 'Кодик' },
      { id: 'kodik:1:1:1', voice: 'Анилибрия', name: 'Анилибрия' },
    ],
  };

  await assert.rejects(
    service.resolvePlayback(kodikStream, episode, { type: 'tv', title: 'Serial', tmdbId: 1 }, [episode], '1:1'),
    /voiceNotFound:Несуществующая озвучка/,
  );
  assert.equal(calls.length, 0);
});

test('no requested voice keeps the stored selection semantics unchanged', async () => {
  const calls = [];
  const client = {
    async resolvePlayback(selection) {
      calls.push(selection);
      return { streamUrl: `https://cdn.test/s${selection.season}e${selection.episode}.m3u8`, streamType: 'm3u8' };
    },
  };
  const episodeService = { fetchEpisodes: async () => ({ episodes: [] }) };
  const service = createPlaybackService({
    client,
    episodeService,
    sessionStore: createSessionStore(),
    pluginId: 'online-balancers',
    translate: key => key,
    playVideo: () => {},
  });
  const audios = [
    { id: 'kodik:1:1:0', voice: 'Кодик', name: 'Кодик' },
    { id: 'kodik:1:1:1', voice: 'Анилибрия', name: 'Анилибрия' },
  ];

  // selectedAudioId still wins when no voice is requested.
  const bySelection = await service.resolvePlayback(
    kodikStream,
    { id: '1:1', season: 1, episode: 1, providerId: 'kodik', sourceId: 'serial-4898', query: kodikStream.query, selectedAudioId: 'kodik:1:1:1', audios },
    { type: 'tv', title: 'Serial', tmdbId: 1 },
    [],
  );
  assert.equal(bySelection.streamUrl, 'https://cdn.test/s1e1.m3u8');

  // Without any hint the first candidate is resolved.
  const byDefault = await service.resolvePlayback(
    kodikStream,
    { id: '1:2', season: 1, episode: 2, providerId: 'kodik', sourceId: 'serial-4898', query: kodikStream.query, audios },
    { type: 'tv', title: 'Serial', tmdbId: 1 },
    [],
  );
  assert.equal(byDefault.streamUrl, 'https://cdn.test/s1e2.m3u8');
  assert.equal(calls.length, 2);
});

test('a repeat voice switch for the same episode is served from the resolution cache', async () => {
  const calls = [];
  const client = {
    async resolvePlayback(selection) {
      calls.push(selection);
      return { streamUrl: `https://cdn.test/s${selection.season}e${selection.episode}.m3u8`, streamType: 'm3u8', voice: selection.voice };
    },
  };
  const episodeService = { fetchEpisodes: async () => ({ episodes: [] }) };
  const service = createPlaybackService({
    client,
    episodeService,
    sessionStore: createSessionStore(),
    pluginId: 'online-balancers',
    translate: key => key,
    playVideo: () => {},
  });

  const episode = {
    id: '1:1',
    season: 1,
    episode: 1,
    providerId: 'kodik',
    sourceId: 'serial-4898',
    query: kodikStream.query,
    voice: 'Анилибрия',
    audios: [
      { id: 'kodik:1:1:0', voice: 'Кодик', name: 'Кодик' },
      { id: 'kodik:1:1:1', voice: 'Анилибрия', name: 'Анилибрия' },
    ],
  };

  const first = await service.resolvePlayback(kodikStream, episode, { type: 'tv', title: 'Serial', tmdbId: 1 }, [episode], '1:1');
  const second = await service.resolvePlayback(kodikStream, episode, { type: 'tv', title: 'Serial', tmdbId: 1 }, [episode], '1:1');

  assert.equal(calls.length, 1);
  assert.equal(second.streamUrl, first.streamUrl);
  assert.equal(second.voice, 'Анилибрия');
});

test('a cross-provider merged episode preserves per-candidate identity and re-resolves via the candidate provider', async () => {
  const calls = [];
  const client = {
    async resolvePlayback(selection) {
      calls.push(selection);
      return {
        streamUrl: `https://cdn.test/${selection.provider}-s${selection.season}e${selection.episode}.m3u8`,
        streamType: 'm3u8',
      };
    },
  };
  const episodeService = { fetchEpisodes: async () => ({ episodes: [] }) };
  const service = createPlaybackService({
    client,
    episodeService,
    sessionStore: createSessionStore(),
    pluginId: 'online-balancers',
    translate: key => key,
    playVideo: () => {},
  });

  const anilibertyStream = {
    id: 'aniliberty:42',
    title: 'Serial',
    provider: 'AniLiberty',
    providerId: 'aniliberty',
    sourceId: '42',
    query: kodikStream.query,
    quality: '1080p',
    url: 'online-balancers://aniliberty/42',
    streamUrl: 'online-balancers://aniliberty/42',
  };
  const episodeBase = { season: 1, number: 1, episode: 1, title: 'Episode 1', url: '' };
  const merged = mergeEpisodeVariants([
    { stream: kodikStream, result: { episodes: [{ ...episodeBase, id: 'k1', audios: [{ id: 'a', name: 'AniDUB' }] }] } },
    { stream: anilibertyStream, result: { episodes: [{ ...episodeBase, id: 'al1', audios: [{ id: 'b', name: 'AniLiberty' }] }] } },
  ]);

  assert.equal(merged.length, 1);
  const episode = merged[0];
  assert.equal(episode.audios.length, 2);

  // The user switches to voice B — the AniLiberty candidate. That candidate keeps its own
  // provider identity from the merge, so the upstream resolution must go through AniLiberty,
  // not through the primary Kodik stream.
  const payload = await service.resolvePlayback(
    kodikStream,
    { ...episode, voice: 'aniliberty' },
    { type: 'tv', title: 'Serial', tmdbId: 1 },
    [episode],
    episode.id,
  );

  assert.equal(calls[0].provider, 'aniliberty');
  assert.equal(calls[0].sourceId, '42');
  assert.equal(payload.streamUrl, 'https://cdn.test/aniliberty-s1e1.m3u8');
  assert.equal(payload.voice, 'AniLiberty');
  // Top-level audios carry the FULL "Voice · Quality · Provider" label as the canonical name
  // (plus each candidate's OWN provider identity); urls are blank (candidates were never
  // resolved), so any switch re-resolves through the candidate's provider instead of reusing
  // one fabricated `?audio=N` link.
  assert.deepEqual(
    payload.audios.map(audio => ({ name: audio.name, voice: audio.voice, providerId: audio.providerId, sourceId: audio.sourceId, url: audio.url })),
    [
      { name: 'AniDUB · 720p · Kodik', voice: 'AniDUB', providerId: 'kodik', sourceId: 'serial-4898', url: '' },
      { name: 'AniLiberty · 1080p · AniLiberty', voice: 'AniLiberty', providerId: 'aniliberty', sourceId: '42', url: '' },
    ],
  );
  // Playlist items carry the same per-candidate identity for host-side voice switching.
  assert.deepEqual(
    payload.playlist[0].audios.map(audio => ({ name: audio.name, providerId: audio.providerId, sourceId: audio.sourceId, url: audio.url })),
    [
      { name: 'AniDUB · 720p · Kodik', providerId: 'kodik', sourceId: 'serial-4898', url: '' },
      { name: 'AniLiberty · 1080p · AniLiberty', providerId: 'aniliberty', sourceId: '42', url: '' },
    ],
  );
});


test('playlist resolution is a sliding window: 3 before the selected episode, 5 after', async () => {
  const calls = [];
  const client = {
    async resolvePlayback(selection) {
      calls.push(selection);
      return { streamUrl: `https://cdn.test/s${selection.season}e${selection.episode}.m3u8`, streamType: 'm3u8' };
    },
  };
  const episodeService = { fetchEpisodes: async () => ({ episodes: [] }) };
  const service = createPlaybackService({
    client,
    episodeService,
    sessionStore: createSessionStore(),
    pluginId: 'online-balancers',
    translate: key => key,
    playVideo: () => {},
  });

  const episodes = Array.from({ length: 10 }, (_, i) => ({
    id: `1:${i + 1}`,
    season: 1,
    episode: i + 1,
    providerId: 'kodik',
    sourceId: 'serial-4898',
    query: kodikStream.query,
    url: pseudoUrl,
  }));
  const selected = episodes[4];

  const payload = await service.resolvePlayback(
    kodikStream,
    selected,
    { type: 'tv', title: 'Serial', tmdbId: 1 },
    episodes,
    selected.id,
  );

  // The payload does NOT wait for the window (a slow window episode must not delay the
  // player open) — with synchronous mocks the window may already have landed by the time
  // the payload resolves, so only the post-flush totals are asserted below.
  assert.equal(payload.playlist.length, 10);
  // Playlist items keep their handles; stream URLs come from the cache on navigation.
  assert.equal(payload.playlist[0].streamUrl, pseudoUrl);
  assert.equal(payload.playlist[4].streamUrl, pseudoUrl);

  await new Promise(resolve => setTimeout(resolve, 0));
  // Window = indices 1..9 (episodes 2..10), minus the just-resolved anchor: 8 background calls.
  assert.equal(calls.length, 9);
  // Episodes inside the window are cached — a repeat navigation costs no upstream call.
  const repeat = await service.resolvePlayback(
    kodikStream,
    episodes[9],
    { type: 'tv', title: 'Serial', tmdbId: 1 },
    episodes,
    episodes[9].id,
  );
  assert.equal(repeat.streamUrl, 'https://cdn.test/s1e10.m3u8');
  assert.equal(calls.length, 9);
});

test('a window anchored at the first episode has no "before" part and a far jump re-windows', async () => {
  const calls = [];
  const client = {
    async resolvePlayback(selection) {
      calls.push(selection);
      return { streamUrl: `https://cdn.test/s${selection.season}e${selection.episode}.m3u8`, streamType: 'm3u8' };
    },
  };
  const episodeService = { fetchEpisodes: async () => ({ episodes: [] }) };
  const service = createPlaybackService({
    client,
    episodeService,
    sessionStore: createSessionStore(),
    pluginId: 'online-balancers',
    translate: key => key,
    playVideo: () => {},
  });

  const episodes = Array.from({ length: 12 }, (_, i) => ({
    id: `1:${i + 1}`,
    season: 1,
    episode: i + 1,
    providerId: 'kodik',
    sourceId: 'serial-4898',
    query: kodikStream.query,
    url: pseudoUrl,
  }));

  // Anchor at index 0 → the payload carries the primary immediately; the window
  // (episodes 2..6 — 5 after) lands in the background cache.
  const first = await service.resolvePlayback(
    kodikStream,
    episodes[0],
    { type: 'tv', title: 'Serial', tmdbId: 1 },
    episodes,
    '1:1',
  );
  assert.equal(first.playlist[5].streamUrl, pseudoUrl);
  assert.equal(first.playlist[6].streamUrl, pseudoUrl);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.length, 6);

  // Far jump to episode 12: the primary resolves live, the new window's "before"
  // slice (9, 10, 11) resolves in the background — 6 + 1 + 3 = 10 upstream calls total.
  const jumped = await service.resolvePlayback(
    kodikStream,
    episodes[11],
    { type: 'tv', title: 'Serial', tmdbId: 1 },
    episodes,
    '1:12',
  );
  assert.equal(jumped.streamUrl, 'https://cdn.test/s1e12.m3u8');
  assert.equal(jumped.playlist[10].streamUrl, pseudoUrl);
  assert.equal(jumped.playlist[7].streamUrl, pseudoUrl);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.length, 10);
  // The window cache serves a back-navigation to episode 11 without a new primary call;
  // the re-window around ep11 resolves the one still-missing episode (ep8) in the background.
  const back = await service.resolvePlayback(
    kodikStream,
    episodes[10],
    { type: 'tv', title: 'Serial', tmdbId: 1 },
    episodes,
    '1:11',
  );
  assert.equal(back.streamUrl, 'https://cdn.test/s1e11.m3u8');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.length, 11);
});
