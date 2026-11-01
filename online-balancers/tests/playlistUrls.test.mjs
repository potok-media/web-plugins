import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeEpisodeVariants } from '../plugin/episodes/mergeVariants.js';
import { resolveEpisodeUrls } from '../plugin/episodes/episodesController.js';
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

test('resolveEpisodeUrls resolves pseudo-url episodes through the client', async () => {
  const calls = [];
  const client = {
    async resolvePlayback(selection) {
      calls.push(selection);
      return { streamUrl: `https://cdn.test/${selection.episode}.m3u8`, streamType: 'm3u8' };
    },
  };
  const episodes = [
    { id: '1:1', season: 1, episode: 1, url: pseudoUrl, providerId: 'kodik', sourceId: 'serial-4898', query: {} },
    { id: '1:2', season: 1, episode: 2, url: '', providerId: 'kodik', sourceId: 'serial-4898', query: {} },
    { id: '1:3', season: 1, episode: 3, url: 'https://cdn.test/already.m3u8', providerId: 'kodik' },
  ];

  const { episodes: resolved, hasUrlResolution } = await resolveEpisodeUrls({
    client,
    episodes,
    primaryProviderId: 'kodik',
  });

  assert.equal(hasUrlResolution, true);
  assert.equal(resolved[0].url, 'https://cdn.test/1.m3u8');
  assert.equal(resolved[0].streamUrl, 'https://cdn.test/1.m3u8');
  assert.equal(resolved[1].url, 'https://cdn.test/2.m3u8');
  assert.equal(resolved[2].url, 'https://cdn.test/already.m3u8');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(selection => selection.episode), [1, 2]);
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

  assert.equal(payload.streamUrl, 'https://cdn.test/s1e1.m3u8?audio=0');
  assert.deepEqual(payload.headers, streamHeaders);
  assert.equal(payload.playlist.length, 3);
  assert.equal(payload.playlist[0].streamUrl, 'https://cdn.test/s1e1.m3u8');
  assert.deepEqual(payload.playlist[0].headers, streamHeaders);
  assert.equal(payload.playlist[1].streamUrl, 'https://cdn.test/s1e2.m3u8');
  assert.deepEqual(payload.playlist[1].headers, streamHeaders);
  assert.equal(payload.playlist[2].streamUrl, 'https://cdn.test/direct.m3u8');
  assert.deepEqual(payload.sourceStream.query, kodikStream.query);
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

  // A voice of the SAME source shares the cached stream — no extra call.
  await service.resolvePlayback(stream, { ...episode, voice: 'SHIZA' }, { type: 'tv', title: 'Serial' });
  assert.equal(playbackCalls, 1);

  // A different source is a different stream and must resolve again.
  await service.resolvePlayback(stream, { ...episode, sourceId: 'serial-9999' }, { type: 'tv', title: 'Serial' });
  assert.equal(playbackCalls, 2);
});
