import assert from 'node:assert/strict';
import test from 'node:test';

import { createEpisodeService, episodeLocator, episodeUrl } from '../plugin/episodes/episodesController.js';
import { mergeEpisodeVariants, movieEpisode } from '../plugin/episodes/mergeVariants.js';

test('episodes from several providers merge while preserving playback candidates', () => {
  const results = [
    {
      stream: { id: 'a:1', providerId: 'a', provider: 'A', sourceId: '1', quality: '1080p', query: {} },
      result: { episodes: [{ id: 'a-1', season: 1, episode: 1, title: 'Episode 1', locator: 'a-locator', audios: [] }] },
    },
    {
      stream: { id: 'b:2', providerId: 'b', provider: 'B', sourceId: '2', quality: '720p', voice: 'Dub', query: {} },
      result: { episodes: [{ id: 'b-1', season: 1, episode: 1, title: 'Episode 1', locator: 'b-locator', audios: [] }] },
    },
  ];

  const [episode] = mergeEpisodeVariants(results);
  assert.equal(episode.id, '1:1');
  assert.equal(episode.audios.length, 2);
  assert.deepEqual(episode.audios.map(item => item.providerId), ['a', 'b']);
  assert.equal(episodeLocator({ url: episodeUrl('signed-locator') }), 'signed-locator');
});

test('movie groups become a single playable pseudo-episode', () => {
  const episode = movieEpisode({
    id: 'group:movie',
    title: 'Movie',
    variants: [{ id: 'a:1', providerId: 'a', provider: 'A', sourceId: '1', quality: '1080p' }],
  });
  assert.equal(episode.episode, 1);
  assert.equal(episode.audios.length, 1);
});

test('ARM canonicalizes anime episodes while provider locators keep their raw coordinates', async () => {
  const rawEpisodes = season => Array.from({ length: 24 }, (_, index) => ({
    id: `raw-${season}-${index + 1}`,
    season,
    number: index + 1,
    title: `Provider episode ${index + 1}`,
    locator: `provider-s${season}-e${index + 1}`,
  }));
  const armEpisodes = Array.from({ length: 24 }, (_, index) => ({
    id: `arm-episode-${index + 1}`,
    number: index + 1,
    title: `ARM episode ${index + 1}`,
  }));
  const client = {
    async getEpisodes({ provider }) {
      return {
        episodes: rawEpisodes(provider === 'kodik' ? 2 : 1),
        seasonsCount: provider === 'kodik' ? 2 : 1,
      };
    },
  };
  const arm = {
    async resolveWork(input) {
      assert.deepEqual(input, { provider: 'tmdb', entityKind: 'tv', value: '83100' });
      return { workId: 'dororo-work', graphVersion: 'graph-v1' };
    },
    async getEpisodeLayout(workId) {
      assert.equal(workId, 'dororo-work');
      return {
        graphVersion: 'graph-v1',
        groups: [{
          id: 'dororo-entry',
          kind: 'season',
          number: 1,
          title: 'Дороро',
          aniListId: 101347,
          malId: 37520,
          episodes: armEpisodes,
        }],
      };
    },
  };
  const service = createEpisodeService({
    client,
    arm,
    translate: (_key, values) => `Episode ${values.number}`,
  });
  const group = {
    id: 'dororo',
    entryId: 'dororo-entry',
    mediaType: 'tv',
    variants: [
      { id: 'aniliberty:8034', providerId: 'aniliberty', provider: 'AniLiberty', sourceId: '8034', query: {} },
      { id: 'kodik:13964', providerId: 'kodik', provider: 'Kodik', sourceId: '13964', query: {} },
    ],
  };

  const result = await service.fetchGroupedEpisodes(group, {
    type: 'tv',
    tmdbId: 83100,
    title: 'Дороро',
  });

  assert.equal(result.episodes.length, 24);
  assert.deepEqual([...new Set(result.episodes.map(episode => episode.season))], [1]);
  assert.equal(result.arm.state, 'resolved');
  assert.equal(result.arm.workId, 'dororo-work');
  assert.equal(result.episodes[0].workId, 'dororo-work');
  assert.equal(result.episodes[0].entryId, 'dororo-entry');
  assert.equal(result.episodes[0].episodeId, 'arm-episode-1');
  assert.equal(result.episodes[0].displayOrdinal, '1');
  assert.equal(result.episodes[0].title, 'ARM episode 1');
  assert.equal(result.episodes[0].audios.length, 2);
  assert.deepEqual(
    result.episodes[0].audios.map(candidate => candidate.locator).sort(),
    ['provider-s1-e1', 'provider-s2-e1'],
  );
});

test('episode loading stays usable when ARM cannot resolve the work', async () => {
  const service = createEpisodeService({
    client: {
      async getEpisodes() {
        return {
          episodes: [{ id: 'raw-1', season: 1, number: 1, locator: 'raw-locator' }],
          seasonsCount: 1,
        };
      },
    },
    arm: {
      async resolveWork() {
        throw new Error('ARM unavailable');
      },
    },
    translate: (_key, values) => `Episode ${values.number}`,
  });

  const result = await service.fetchGroupedEpisodes({
    id: 'fallback',
    mediaType: 'tv',
    variants: [{ id: 'provider:1', providerId: 'provider', provider: 'Provider', sourceId: '1' }],
  }, { type: 'tv', tmdbId: 7 });

  assert.equal(result.arm, null);
  assert.equal(result.episodes.length, 1);
  assert.equal(result.episodes[0].locator, 'raw-locator');
});
