import assert from 'node:assert/strict';
import test from 'node:test';

import { groupSources, normalizeGroupTitle, visibleGroups } from '../plugin/search/grouping.js';

test('search variants are grouped by normalized aliases, type and compatible year', () => {
  const groups = groupSources([
    { id: 'a', providerId: 'aniliberty', provider: 'AniLiberty', title: 'Anime / Аниме', originalTitle: 'Anime', year: 2024, mediaType: 'tv', quality: '1080p' },
    { id: 'b', providerId: 'kodik', provider: 'Kodik', title: 'Аниме', originalTitle: 'Anime', year: 2024, mediaType: 'tv', quality: '720p', voice: 'Voice' },
    { id: 'c', providerId: 'kodik', provider: 'Kodik', title: 'Anime', originalTitle: 'Anime', year: 2024, mediaType: 'movie', quality: '1080p' },
  ]);

  assert.equal(normalizeGroupTitle('ＡＮＩＭＥ!!!'), 'anime');
  assert.equal(groups.length, 2);
  assert.equal(groups[0].variants.length, 2);
  assert.deepEqual(groups[0].qualities, ['1080p', '720p']);
  assert.deepEqual(groups[0].providers, ['AniLiberty', 'Kodik']);
  assert.equal(visibleGroups(groups, { provider: 'kodik', quality: '720p', voice: 'Voice' }).length, 1);
});

test('ARM identity groups provider variants even when their raw titles and years disagree', () => {
  const groups = groupSources([
    {
      id: 'aniliberty:alicization',
      providerId: 'aniliberty',
      provider: 'AniLiberty',
      title: 'Sword Art Online: Alicization',
      year: 2018,
      mediaType: 'tv',
      entryId: 'entry-alicization',
      armTitle: 'Мастера Меча Онлайн: Алисизация',
      armKind: 'sides',
      armNumber: 2,
    },
    {
      id: 'kodik:alicization',
      providerId: 'kodik',
      provider: 'Kodik',
      title: 'Sword Art Online 3',
      year: 2019,
      mediaType: 'tv',
      entryId: 'entry-alicization',
      armTitle: 'Мастера Меча Онлайн: Алисизация',
      armKind: 'sides',
      armNumber: 2,
    },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, 'arm:entry-alicization');
  assert.equal(groups[0].title, 'Мастера Меча Онлайн: Алисизация');
  assert.equal(groups[0].entryId, 'entry-alicization');
  assert.equal(groups[0].variants.length, 2);
});
