import assert from 'node:assert/strict';
import test from 'node:test';

import { defineSource } from '../plugin/sources/defineSource.js';
import { createSourceRegistry, sourceRegistry } from '../plugin/sources/registry.js';

test('source registry exposes each backend source as an independent descriptor', () => {
  assert.deepEqual(sourceRegistry.ids, [
    'anidub',
    'aniliberty',
    'animevost',
    'kodik',
    'lordfilm',
    'animego',
    'videohub',
    'animeon',
    'animelib',
    'veoveo',
    'alloha',
    'filmix',
    'kinopub',
    'rezka',
  ]);
  assert.equal(sourceRegistry.get('kodik').name, 'Kodik');
  assert.deepEqual(sourceRegistry.accounts.map(source => source.id), ['alloha', 'filmix', 'kinopub', 'rezka']);
  assert.equal(sourceRegistry.get('animelib').adult, true);
  assert.equal(sourceRegistry.get('animeon').adult, false);
  // HTML scrapers ride the slow batch; API-backed sources are fast.
  assert.deepEqual(
    sourceRegistry.ids.filter(id => sourceRegistry.get(id).slow),
    ['anidub', 'animevost', 'lordfilm', 'animego'],
  );
  assert.equal(sourceRegistry.get('kodik').slow, false);
  assert.equal(sourceRegistry.get('aniliberty').slow, false);
  assert.equal(sourceRegistry.get('kinopub').name, 'KinoWatch (KinoPub)');
  assert.equal(sourceRegistry.get('kinopub').authMode, 'device-code');
  assert.equal(sourceRegistry.has('missing'), false);
});

test('source definitions are validated and duplicate ids are rejected', () => {
  const source = defineSource({ id: 'future-source', name: 'Future Source', capabilities: { movies: false } });
  assert.equal(source.capabilities.movies, false);
  assert.equal(source.capabilities.series, true);
  assert.throws(() => createSourceRegistry([source, source]), /Duplicate online source/);
  assert.throws(() => defineSource({ id: '', name: 'Broken' }), /id is required/);
});
