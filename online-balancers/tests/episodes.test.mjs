import assert from 'node:assert/strict';
import test from 'node:test';

import { createEpisodeService } from '../plugin/episodes/episodesController.js';
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
});

test('episode loading stays usable when ARM cannot resolve the work', async () => {
  const service = createEpisodeService({
    client: {
      async getEpisodes() {
        return {
          episodes: [{ id: 'raw-1', season: 1, number: 1, url: '' }],
          seasonsCount: 1,
        };
      },
      async resolvePlayback() {
        throw new Error('playback must not be resolved while merely loading the episode panel');
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
  // Panel items are presented UNRESOLVED — the play path resolves on demand, so opening the
  // panel costs zero /api/v1/playback calls even when every episode lacks a direct URL.
  assert.equal(result.episodes[0].url, '');
  assert.equal(result.episodes[0].streamUrl, undefined);
});

test('an ARM-cast source lays its episodes out by its own entry, not the franchise default', async () => {
  const tv1Episodes = Array.from({ length: 366 }, (_, index) => ({
    id: `tv1-arm-${index + 1}`,
    number: index + 1,
    title: `TV-1 episode ${index + 1}`,
  }));
  const tybwEpisodes = Array.from({ length: 13 }, (_, index) => ({
    id: `tybw-arm-${index + 1}`,
    number: index + 1,
    title: `TYBW episode ${index + 1}`,
  }));
  const layout = {
    graphVersion: 'bleach-graph',
    groups: [
      {
        id: 'bleach-tv1', kind: 'season', number: 1, title: 'Блич [ТВ-1]', aniListId: 1,
        episodes: tv1Episodes,
      },
      {
        id: 'bleach-tybw-conflict', kind: 'season', number: 2,
        title: 'Блич: Тысячелетняя кровавая война — Конфликт', aniListId: 2,
        episodes: tybwEpisodes,
      },
    ],
  };
  const makeService = () => createEpisodeService({
    client: {
      async getEpisodes() {
        return {
          episodes: Array.from({ length: 13 }, (_, index) => ({
            id: `raw-${index + 1}`,
            season: 1,
            number: index + 1,
            title: `Raw ${index + 1}`,
          })),
          seasonsCount: 1,
        };
      },
    },
    arm: {
      async resolveWork() {
        return { workId: 'bleach-work', graphVersion: 'bleach-graph' };
      },
      async getEpisodeLayout(workId) {
        assert.equal(workId, 'bleach-work');
        return layout;
      },
    },
    translate: (_key, values) => `Episode ${values.number}`,
  });
  const context = { type: 'tv', tmdbId: 76116, title: 'Блич: Тысячелетняя кровавая война — Конфликт' };

  // The source was cast to the TYBW entry: its 13-episode block must land in the TYBW group
  // even though the numbers 1–13 also exist in the TV-1 group (the user's Bleach bug).
  const scoped = await makeService().fetchGroupedEpisodes({
    id: 'arm:bleach-tybw-conflict',
    entryId: 'bleach-tybw-conflict',
    mediaType: 'tv',
    variants: [{ id: 'animego:7', providerId: 'animego', provider: 'AnimeGo', sourceId: '7', query: {} }],
  }, context);

  assert.equal(scoped.episodes.length, 13);
  assert.deepEqual([...new Set(scoped.episodes.map(episode => episode.entryId))], ['bleach-tybw-conflict']);
  assert.equal(scoped.episodes[0].episode, 1);
  assert.equal(scoped.episodes[12].episode, 13);
  assert.equal(scoped.episodes[0].title, 'TYBW episode 1');
  assert.equal(scoped.arm.state, 'resolved');
  assert.equal(scoped.arm.workId, 'bleach-work');

  // A source WITHOUT a cast entryId keeps the previous full-franchise behavior.
  const unscoped = await makeService().fetchGroupedEpisodes({
    id: 'group:unknown',
    mediaType: 'tv',
    variants: [{ id: 'kodik:1', providerId: 'kodik', provider: 'Kodik', sourceId: '1', query: {} }],
  }, context);

  assert.equal(unscoped.episodes.length, 13);
  assert.deepEqual([...new Set(unscoped.episodes.map(episode => episode.entryId))], ['bleach-tv1']);
});

test('getEpisodes path attaches ARM identity so progress keys converge (withArmIdentity)', async () => {
  const client = {
    async getEpisodes() {
      return {
        seasonsCount: 1,
        episodes: [
          { id: 'kodik:serial-1:1:1', season: 1, number: 1, title: '1 серия', audios: [] },
          { id: 'kodik:serial-1:1:2', season: 1, number: 2, title: '2 серия', audios: [] },
        ],
      };
    },
  };
  const arm = {
    async resolveWork() { return { workId: 'work-1', graphVersion: 'v1' }; },
    async getEpisodeLayout() {
      return {
        graphVersion: 'v1',
        groups: [{
          id: 'entry-1', kind: 'season', number: 1, title: 'Сезон 1', aniListId: 1,
          episodes: [
            { id: 'arm-ep-1', number: 1, title: null },
            { id: 'arm-ep-2', number: 2, title: null },
          ],
        }],
      };
    },
  };
  const service = createEpisodeService({
    client,
    translate: key => key,
    arm,
  });
  const stream = { id: 'kodik:serial-1', provider: 'Kodik', providerId: 'kodik', sourceId: 'serial-1', query: { tmdbId: 85937 } };
  const context = { type: 'tv', tmdbId: 85937 };

  // The grouped flow stays raw (it canonicalizes itself after merging).
  const groupedRaw = await service.fetchEpisodes(stream, context);
  assert.equal(groupedRaw.episodes[0].workId, undefined);

  // The host-facing getEpisodes path (episode panels / continue-watching resume) attaches ids.
  const enriched = await service.fetchEpisodes(stream, context, { withArmIdentity: true });
  assert.equal(enriched.episodes[1].workId, 'work-1');
  assert.equal(enriched.episodes[1].episodeId, 'arm-ep-2');
  assert.equal(enriched.episodes[1].entryId, 'entry-1');
  assert.equal(enriched.episodes[1].episode, 2);
});
