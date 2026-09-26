import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEntryHint, normalizeTitle } from '../utils/entryHint.js';

const entry = (id, title, extra = {}) => ({
  id,
  kind: 'season',
  number: 0,
  title,
  titles: {},
  ...extra,
});

const kimetsuLayout = {
  work: { id: 'work-1', title: 'Demon Slayer' },
  groups: [
    entry('s1', 'Kimetsu no Yaiba', { tmdbShow: 1429, tmdbSeason: 1 }),
    // TMDB folds the Mugen Train TV recut into the movie/S2 — no own season coordinate.
    entry('s2', 'Kimetsu no Yaiba: Mugen Ressha-hen', { tmdbShow: 1429, tmdbSeason: null }),
    entry('s3', 'Kimetsu no Yaiba: Yuukaku-hen', { tmdbShow: 1429, tmdbSeason: 2 }),
    entry('s4', 'Kimetsu no Yaiba: Katanakaji no Sato-hen', { tmdbShow: 1429, tmdbSeason: 3 }),
    entry('s5', 'Kimetsu no Yaiba: Hashira Geiko-hen', {
      tmdbShow: 1429,
      tmdbSeason: 4,
      titles: { ru: 'Клинок, рассекающий демонов: Тренировка столпов', en: 'Demon Slayer: Hashira Training' },
    }),
  ],
};

test('arc name in the release title pins the unique matching entry', () => {
  assert.equal(
    resolveEntryHint(
      'Клинок, рассекающий демонов: Тренировка столпов (ТВ-4) / Kimetsu no Yaiba: Hashira Geiko hen',
      kimetsuLayout,
      1429,
    ),
    's5',
  );
});

test('arc suffix matches even when the franchise prefix differs', () => {
  assert.equal(
    resolveEntryHint('[Moozzi2] Kimetsu no Yaiba - Hashira Geiko-hen [BDRip 1080p]', kimetsuLayout, 1429),
    's5',
  );
});

test('russian title variant matches too', () => {
  assert.equal(resolveEntryHint('Клинок: Тренировка столпов [2024]', kimetsuLayout, 1429), 's5');
});

test('a season marker only corroborates; it never overrides a unique name match', () => {
  // "ТВ-4" contradicts tmdbSeason=5 of Hashira Training — the name still wins.
  assert.equal(
    resolveEntryHint('Kimetsu no Yaiba: Hashira Geiko-hen (ТВ-4)', kimetsuLayout, 1429),
    's5',
  );
});

test('no name match stays unpinned', () => {
  assert.equal(resolveEntryHint('Some Other Show (ТВ-4)', kimetsuLayout, 1429), null);
});

test('the longest title match wins over the bare franchise name', () => {
  // s1's title "Kimetsu no Yaiba" is a substring of every franchise release; the full arc
  // title of s5 is longer and must win.
  assert.equal(
    resolveEntryHint('Kimetsu no Yaiba: Hashira Geiko-hen (ТВ-4)', kimetsuLayout, 1429),
    's5',
  );
});

test('a bare franchise title pins only through marker + bridge corroboration', () => {
  // Base name alone would match the whole franchise; ТВ-1 corroborates s1's own TMDB
  // coordinate, so s1 is pinned. The owner's "4th season" lands on Hashira Training
  // through the bridge (TMDB S4), never on the bare base season.
  assert.equal(resolveEntryHint('Kimetsu no Yaiba (ТВ-1)', kimetsuLayout, 1429), 's1');
  assert.equal(resolveEntryHint('Kimetsu no Yaiba (ТВ-4)', kimetsuLayout, 1429), 's5');
});

test('equal-length ties are narrowed by the tmdb season corroboration only', () => {
  const layout = {
    work: { id: 'w' },
    groups: [
      entry('a', 'Show: Warriors Arc', { tmdbShow: 1, tmdbSeason: 2 }),
      entry('b', 'Show: Warriors Arc', { tmdbShow: 1, tmdbSeason: 3 }),
    ],
  };
  assert.equal(resolveEntryHint('Show: Warriors Arc (ТВ-2)', layout, 1), 'a');
  assert.equal(resolveEntryHint('Show: Warriors Arc', layout, 1), null);
});

test('generic kind words never pin anything', () => {
  const layout = { work: { id: 'w' }, groups: [entry('x', 'Specials'), entry('y', 'OVA')] };
  assert.equal(resolveEntryHint('Some Show Specials', layout, 1), null);
});

test('normalizeTitle folds punctuation, case and yo', () => {
  assert.equal(normalizeTitle('Клинок,  Рассекающий: Ёлка-4!'), 'клинок рассекающий елка 4');
});
