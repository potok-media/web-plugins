import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCanonicalOverrides } from '../utils/armOverrides.js';

const WORK = 'work-1';

function layout(episodeCount = 12) {
  return {
    work: { id: WORK },
    graphVersion: 'graph',
    groups: [{
      id: 'season-1', kind: 'season', number: 1,
      episodes: Array.from({ length: episodeCount }, (_, index) => ({ id: `ep-${index + 1}`, number: index + 1 })),
    }],
  };
}

const files = ['a', 'b', 'c'].map((id) => ({ id }));
const gatewayBinding = (id) => ({ fileId: id, state: 'unresolved', targets: [] });

test('a pin fixes exactly its file at the target, whatever the gateway answered', () => {
  const bindings = applyCanonicalOverrides(
    files.map((file) => gatewayBinding(file.id)), files,
    { a: { mode: 'pin', armTarget: { workId: WORK, entryId: 'season-1', episodeId: 'ep-5' } } },
    layout(), WORK);

  const pin = bindings.find((binding) => binding.fileId === 'a');
  assert.equal(pin.state, 'resolved');
  assert.deepEqual(pin.targets, [{ entryId: 'season-1', episodeId: 'ep-5' }]);
  assert.equal(pin.method, 'override-pin');
  // The other files keep the gateway's answer untouched.
  assert.equal(bindings.find((binding) => binding.fileId === 'b').state, 'unresolved');
});

test('an anchor walks the playback order forward across the rest of the torrent', () => {
  const bindings = applyCanonicalOverrides(
    files.map((file) => gatewayBinding(file.id)), files,
    { a: { mode: 'anchor', armTarget: { workId: WORK, entryId: 'season-1', episodeId: 'ep-7' } } },
    layout(), WORK);

  assert.deepEqual(
    bindings.map((binding) => binding.targets[0]?.episodeId),
    ['ep-7', 'ep-8', 'ep-9']);
  assert.deepEqual(
    bindings.map((binding) => binding.method),
    ['override-anchor', 'override-continuity', 'override-continuity']);
});

test('a scoped anchor binds only the listed files in scope order', () => {
  const bindings = applyCanonicalOverrides(
    files.map((file) => gatewayBinding(file.id)), files,
    { a: { mode: 'anchor', scopeFileIds: ['a', 'c'], armTarget: { workId: WORK, entryId: 'season-1', episodeId: 'ep-2' } } },
    layout(), WORK);

  assert.equal(bindings.find((binding) => binding.fileId === 'a').targets[0].episodeId, 'ep-2');
  assert.equal(bindings.find((binding) => binding.fileId === 'c').targets[0].episodeId, 'ep-3');
  assert.equal(bindings.find((binding) => binding.fileId === 'b').state, 'unresolved');
});

test('stale or foreign targets never fabricate a binding', () => {
  const bindings = applyCanonicalOverrides(
    files.map((file) => gatewayBinding(file.id)), files,
    {
      a: { mode: 'pin', armTarget: { workId: WORK, entryId: 'season-1', episodeId: 'ep-404' } },
      b: { mode: 'pin', armTarget: { workId: 'other-work', entryId: 'season-1', episodeId: 'ep-1' } },
    },
    layout(), WORK);

  assert.equal(bindings.find((binding) => binding.fileId === 'a').state, 'unresolved');
  assert.equal(bindings.find((binding) => binding.fileId === 'b').state, 'unresolved');
});
