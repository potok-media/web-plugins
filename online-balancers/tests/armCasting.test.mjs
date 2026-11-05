import assert from 'node:assert/strict';
import test from 'node:test';

import { castSourcesToArmEntries } from '../plugin/search/armCasting.js';

test('search output is reduced to canonical ARM entries and keeps provider variants nested', async () => {
  const arm = {
    async getEntries(workId, options) {
      assert.equal(workId, 'sao-work');
      assert.deepEqual(options, { locale: 'ru' });
      return {
        entries: [
          {
            entryId: 'sao-1', kind: 'season', number: 1, sortPosition: 1,
            localizedTitles: [
              { language: 'ru', value: 'Мастера Меча Онлайн' },
              { language: 'en', value: 'Sword Art Online' },
            ],
            tmdb: { showId: 45782, season: 1 },
          },
          {
            entryId: 'sao-alicization', kind: 'sides', number: 2, sortPosition: 3,
            localizedTitles: [
              { language: 'ru', value: 'Мастера Меча Онлайн: Алисизация' },
              { language: 'en', value: 'Sword Art Online: Alicization' },
            ],
            tmdb: { showId: 45782, season: 3 },
          },
        ],
      };
    },
  };
  const sources = [
    { id: 'aniliberty:1', title: 'Sword Art Online: Alicization', originalTitle: '', providerId: 'aniliberty' },
    { id: 'kodik:1', title: 'Мастера Меча Онлайн: Алисизация', originalTitle: '', providerId: 'kodik' },
    { id: 'kodik:progressive', title: 'Sword Art Online Progressive: Aria', originalTitle: '', providerId: 'kodik' },
  ];

  const result = await castSourcesToArmEntries({
    arm,
    context: { workId: 'sao-work', type: 'tv', locale: 'ru' },
    sources,
  });

  assert.deepEqual(result.items.map(item => item.entryId), ['sao-alicization', 'sao-alicization']);
  assert.deepEqual(result.items.map(item => item.providerId), ['aniliberty', 'kodik']);
  assert.equal(result.items[0].armTitle, 'Мастера Меча Онлайн: Алисизация');
  assert.equal(result.items[0].armNumber, 2);
  assert.deepEqual(result.unresolvedItems.map(item => item.id), ['kodik:progressive']);
});

test('a known catalog item never falls back to fake raw seasons when ARM cannot resolve it', async () => {
  const sources = [{ id: 'provider:1', title: 'Unknown title', providerId: 'provider' }];
  const result = await castSourcesToArmEntries({
    arm: {
      async resolveWork() { return { workId: null }; },
      async getEntries() { throw new Error('must not request entries without a work'); },
    },
    context: { type: 'tv', tmdbId: 404 },
    sources,
  });

  assert.deepEqual(result.items, []);
  assert.deepEqual(result.unresolvedItems, sources);
});

test('franchise sources bind to their own ARM entries by title containment', async () => {
  const arm = {
    async getEntries(workId) {
      assert.equal(workId, 'bleach-work');
      return {
        entries: [
          {
            entryId: 'bleach-tv1', kind: 'season', number: 1, sortPosition: 1,
            localizedTitles: [{ language: 'ru', value: 'Блич [ТВ-1]' }],
          },
          {
            entryId: 'bleach-rain', kind: 'special', number: 2, sortPosition: 2,
            localizedTitles: [{ language: 'ru', value: 'Блич: Воспоминания под дождём' }],
          },
          {
            entryId: 'bleach-tybw-conflict', kind: 'season', number: 3, sortPosition: 3,
            localizedTitles: [{ language: 'ru', value: 'Блич: Тысячелетняя кровавая война — Конфликт' }],
          },
        ],
      };
    },
  };
  const sources = [
    { id: 'kodik:101', title: 'Блич [ТВ-1]', originalTitle: '', providerId: 'kodik' },
    { id: 'animego:7', title: 'Тысячелетняя кровавая война — Конфликт', originalTitle: '', providerId: 'animego' },
    { id: 'animego:9', title: 'Воспоминания под дождём', originalTitle: '', providerId: 'animego' },
  ];

  const result = await castSourcesToArmEntries({
    arm,
    context: { workId: 'bleach-work', type: 'tv', locale: 'ru' },
    sources,
  });

  assert.deepEqual(
    result.items.map(item => [item.id, item.entryId]),
    [
      ['kodik:101', 'bleach-tv1'],
      ['animego:7', 'bleach-tybw-conflict'],
      ['animego:9', 'bleach-rain'],
    ],
  );
  assert.deepEqual(result.unresolvedItems, []);
});
