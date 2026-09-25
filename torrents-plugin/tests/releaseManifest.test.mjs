import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEpisodeBindings, buildReleaseManifest, rawCompatibilityProjection } from '../utils/releaseManifest.js';

const target = { episodeId: 'ep', orderingId: 'order', groupId: 'group', compatibility: { season: 7, episode: 3 } };

test('manifest preserves original names, ordering and manual overrides without authoritative JS parsing', () => {
  const fileOverrides = { 8: { mode: 'pin', armTarget: { workId: 'work', ...target } } };
  const sectionOverrides = { _: { season: 2, offset: -12 } };
  const paths = ['Show/Show - 24.5.mkv', 'One Piece - 1089.mkv', 'Show/S00E01.mkv', 'Show/S01E01-E02.mkv', 'NCOP 01.mkv'];
  const manifest = buildReleaseManifest({
    releaseId: 'pack', releaseTitle: 'Show [TV] Season 2', workId: 'work', orderingId: 'order', mediaType: 'tv',
    files: paths.map((path, index) => ({ id: index + 8, path, sizeBytes: index + 100 })), fileOverrides, sectionOverrides,
  });
  assert.equal(manifest.orderingId, 'order');
  assert.deepEqual(manifest.files.map((file) => file.path), paths);
  assert.deepEqual(manifest.files.map((file) => file.order), [0, 1, 2, 3, 4]);
  assert.equal(manifest.rawEvidence, undefined);
  assert.ok(manifest.files.every((file) => !Object.hasOwn(file, 'rawEvidence')));
  assert.deepEqual(manifest.fileOverrides, fileOverrides);
  assert.deepEqual(manifest.sectionOverrides, sectionOverrides);
});

test('resolved bindings retain identities but do not relabel ARM display numbers as TMDB coordinates', () => {
  const [file] = applyEpisodeBindings([{ id: 1, season: 1, episode: 99, rawEpisode: 99 }], {
    workId: 'work', orderingId: 'order', bindings: [{ fileId: '1', state: 'resolved', targets: [target], confidence: 0.98 }],
  });
  assert.equal(file.episodeId, 'ep');
  assert.equal(file.season, undefined);
  assert.equal(file.episode, undefined);
  assert.equal(file.rawEpisode, 99);
  assert.equal(file.confidence, 0.98);
});

test('joined file preserves all targets without pretending to be a single episode', () => {
  const targets = [target, { ...target, episodeId: 'ep-2' }];
  const [file] = applyEpisodeBindings([{ id: 1 }], {
    workId: 'work', orderingId: 'order', bindings: [{ fileId: '1', state: 'resolved', targets }],
  });
  assert.equal(file.episodeId, null);
  assert.deepEqual(file.episodeIds, ['ep', 'ep-2']);
  assert.equal(file.groupId, 'group');
  assert.deepEqual(file.targets, targets);
});

test('projects legacy single-target bindings into the targets collection', () => {
  const [file] = applyEpisodeBindings([{ id: 1 }], {
    workId: 'work', bindings: [{ fileId: '1', state: 'resolved', ...target }],
  });
  assert.equal(file.episodeId, 'ep');
  assert.deepEqual(file.targets, [target]);
});

test('unresolved, ambiguous or absent bindings cannot leak old canonical identities', () => {
  for (const state of ['unresolved', 'ambiguous', undefined]) {
    const [file] = applyEpisodeBindings([{ id: 'file', episodeId: 'old', episodeIds: ['old'], groupId: 'old', targets: [target] }], {
      workId: 'work', bindings: state ? [{ fileId: 'file', state, episodeId: 'malformed', targets: [target] }] : [],
    });
    assert.equal(file.episodeId, null);
    assert.deepEqual(file.episodeIds, []);
    assert.deepEqual(file.targets, []);
    assert.equal(file.groupId, null);
  }
});

test('raw display projection never invents an episode from file order', () => {
  assert.deepEqual(rawCompatibilityProjection({ mediaType: 'tv', parsed: { episode: 4 }, indexInGroup: 10 }), {
    season: undefined, episode: 4,
  });
  assert.deepEqual(rawCompatibilityProjection({ mediaType: 'tv', parsed: {}, titleSeason: 2, indexInGroup: 10 }), {
    season: 2, episode: undefined,
  });
});

test('invalid saved manual target cannot fall through to raw filename coordinates', () => {
  const [file] = applyEpisodeBindings([{ id: '1', season: 1, episode: 1 }], {
    workId: 'work', orderingId: 'order', bindings: [{ fileId: '1', state: 'unresolved', method: 'manual-invalid' }],
  });
  assert.equal(file.episodeId, null);
  assert.equal(file.season, undefined);
  assert.equal(file.episode, undefined);
});


test('unresolved, ambiguous and unavailable ARM results cannot expose parsed numbers as playback identity', () => {
  for (const state of ['unresolved', 'ambiguous', undefined]) {
    const resolution = state ? { workId: 'work', bindings: [{ fileId: 'f', state }] } : null;
    const [file] = applyEpisodeBindings([{ id: 'f', season: 1, episode: 7, rawSeason: 1, rawEpisode: 7, url: 'file-url' }], resolution);
    assert.equal(file.season, undefined);
    assert.equal(file.episode, undefined);
    assert.equal(file.rawSeason, 1);
    assert.equal(file.rawEpisode, 7);
    assert.equal(file.url, 'file-url');
  }
});
