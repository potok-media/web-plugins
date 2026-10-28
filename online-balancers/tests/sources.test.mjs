import assert from 'node:assert/strict';
import test from 'node:test';

import { defineSource } from '../plugin/sources/defineSource.js';
import { createSourceRegistry, sourceRegistry } from '../plugin/sources/registry.js';

test('source registry exposes each backend source as an independent descriptor', () => {
  assert.deepEqual(sourceRegistry.ids, [
    'aniliberty',
    'kodik',
    'animego',
    'videohub',
    'leproduction',
    'veoveo',
    'alloha',
    'kinopub',
    'rezka',
  ]);
  assert.equal(sourceRegistry.get('kodik').name, 'Kodik');
  assert.deepEqual(sourceRegistry.accounts.map(source => source.id), ['alloha', 'kinopub', 'rezka']);
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
