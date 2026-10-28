import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mediaQuery,
  numericRouteValue,
  pageContextFromRoute,
  pageUrl,
  sanitizeTitle,
} from '../plugin/routing/mediaContext.js';

test('route values are normalized into a backend media query', () => {
  assert.equal(numericRouteValue('42'), 42);
  assert.equal(numericRouteValue('nope'), null);
  assert.equal(sanitizeTitle('  Anime 2: Final!!!  '), 'Anime Final');
  assert.deepEqual(mediaQuery({ mediaType: 'tv', title: 'Anime', tmdbId: '10', year: '' }), {
    type: 'tv',
    title: 'Anime',
    originalTitle: null,
    imdbId: null,
    year: null,
    tmdbId: 10,
    kinopoiskId: null,
  });
});

test('plugin page URL and route parser keep media identity fields', () => {
  const url = new URL(pageUrl('Anime 2: Final!!!', {
    type: 'tv',
    originalTitle: 'Anime Final',
    imdbId: 'tt42',
    year: 2024,
    tmdbId: 10,
    kinopoiskId: 20,
    workId: 'work-10',
    entryId: 'entry-1',
    episodeId: 'episode-3',
  }), 'https://potok.test');

  assert.deepEqual(pageContextFromRoute(Object.fromEntries(url.searchParams)), {
    type: 'tv',
    title: 'Anime Final',
    originalTitle: 'Anime Final',
    imdbId: 'tt42',
    year: 2024,
    tmdbId: 10,
    kinopoiskId: 20,
    workId: 'work-10',
    entryId: 'entry-1',
    episodeId: 'episode-3',
  });
});
