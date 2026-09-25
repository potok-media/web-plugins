import assert from 'node:assert/strict';
import test from 'node:test';
import { applyArmMetadata, armSearchContext, tmdbWorkId } from '../utils/armMetadata.js';

const target = { episodeId: 'ep', orderingId: 'order', groupId: 'group' };
const resolution = { workId: 'work', orderingId: 'order', graphVersion: 'graph' };
const file = { id: 'file', resolutionState: 'resolved', targets: [target], title: 'original.mkv' };
function layout(refs = []) {
  return {
    ...resolution, ordering: { id: 'order' }, groups: [{
      id: 'group', kind: 'season', displayNumber: 3, displayTitle: { value: 'Cour 2' },
      episodes: [{ id: 'ep', ordinal: '13', displaySeasonNumber: 8, displayEpisodeNumber: 13,
        displayTitle: { value: 'ARM title' }, providerReferences: refs, stillPath: '/arm.jpg', annotation: { relation: 'filler' } }],
    }],
  };
}

test('uses ARM metadata and only actual TMDB provider references for compatibility', () => {
  const [result] = applyArmMetadata([file], resolution, layout([{ provider: 'tmdb', entityKind: 'tv-episode', value: '42/2/1' }]), 42);
  assert.equal(result.title, 'ARM title');
  assert.equal(result.displayOrdinal, '13');
  assert.equal(result.groupTitle, 'Cour 2');
  assert.equal(result.groupDisplayNumber, 3);
  assert.equal(result.season, 2);
  assert.equal(result.episode, 1);
  assert.equal(result.armAnnotation.relation, 'filler');
});

test('canonical-only episodes keep names without synthetic TMDB coordinates', () => {
  const [result] = applyArmMetadata([file], resolution, layout(), 42);
  assert.equal(result.title, 'ARM title');
  assert.equal(result.season, undefined);
  assert.equal(result.episode, undefined);
});

test('ARM ordering changes presentation order without changing file transport or sidecars', () => {
  const makeFile = (id, groupId, episodeId) => Object.freeze({
    ...file, id, torrentHash: 'original-hash', fileName: `${id}.mkv`,
    url: `https://torrent.test/files/${id}/hls/master.m3u8?xa=4&xs=5`,
    targets: [{ ...target, groupId, episodeId }],
    audios: [{ id: 'audio', name: 'Dub', url: 'https://torrent.test/audio' }],
    headers: { 'X-Source': 'torrent' },
  });
  const main = makeFile('main-file', 'main', 'main-ep');
  const special = makeFile('special-file', 'special', 'special-ep');
  const part = makeFile('special-part', 'special', 'special-ep');
  const unmatched = Object.freeze({ id: 'unknown', resolutionState: 'unresolved', url: 'https://torrent.test/unknown' });
  const data = { ...resolution, ordering: { id: 'order' }, groups: [
    { id: 'main', kind: 'season', sortPosition: 20, episodes: [
      { id: 'main-ep', sortPosition: 1, ordinal: '1', providerReferences: [] },
    ] },
    { id: 'special', kind: 'specials', sortPosition: 10, episodes: [
      { id: 'special-ep', sortPosition: 1, ordinal: '24.5', displayTitle: { value: 'TMDB special title' },
        providerReferences: [{ provider: 'tmdb', entityKind: 'tv-episode', value: '42/0/7' }] },
    ] },
  ] };
  const original = Object.freeze([unmatched, main, special, part]);
  const mapped = applyArmMetadata(original, resolution, data, 42);
  assert.deepEqual(mapped.map(item => item.id), ['special-file', 'special-part', 'main-file', 'unknown']);
  assert.deepEqual(original.map(item => item.id), ['unknown', 'main-file', 'special-file', 'special-part']);
  for (const source of [main, special, part]) {
    const result = mapped.find(item => item.id === source.id);
    for (const key of ['url', 'torrentHash', 'fileName', 'audios', 'headers']) assert.equal(result[key], source[key]);
  }
  assert.equal(mapped[0].displayOrdinal, '24.5');
  assert.equal(mapped[0].season, 0);
  assert.equal(mapped[0].episode, 7);
  assert.equal(mapped[0].title, 'TMDB special title');
  assert.equal(mapped[3], unmatched);
});

test('ignores metadata from a different work, ordering or graph', () => {
  for (const wrong of [{ workId: 'other' }, { ordering: { id: 'other' } }, { graphVersion: 'other' }]) {
    assert.deepEqual(applyArmMetadata([file], resolution, { ...layout(), ...wrong }, 42), [file]);
  }
});

test('does not borrow provider coordinates from another TMDB show or an ambiguous mapping', () => {
  for (const refs of [
    [{ provider: 'tmdb', entityKind: 'tv-episode', value: '99/1/1' }],
    [{ provider: 'tmdb', entityKind: 'tv-episode', value: '42/1/1' }, { provider: 'tmdb', entityKind: 'tv-episode', value: '42/1/2' }],
  ]) assert.equal(applyArmMetadata([file], resolution, layout(refs), 42)[0].episode, undefined);
});

test('joined files receive titles for all targets and no single-episode annotation or TMDB coordinates', () => {
  const data = layout();
  data.groups[0].episodes.push({ id: 'ep2', ordinal: '14', displayTitle: { value: 'Next title' }, providerReferences: [] });
  const [result] = applyArmMetadata([{ ...file, targets: [target, { ...target, episodeId: 'ep2' }] }], resolution, data, 42);
  assert.equal(result.title, 'ARM title / Next title');
  assert.equal(result.displayOrdinal, '13–14');
  assert.equal(result.armAnnotation, undefined);
});

test('search uses two ARM names and keeps every alias for relevance', () => {
  const context = armSearchContext({ title: 'Old', type: 'tv', workId: 'work', tmdbId: 42 }, {
    id: 'work', displayTitle: { value: 'Display' },
    names: [{ value: 'Название', locale: 'ru', role: 'official' }, { value: 'Name', locale: 'en', role: 'official' }, { value: 'Alias', role: 'alias' }],
    providerReferences: [{ provider: 'tmdb', entityKind: 'tv', value: '42' }],
  });
  assert.equal(context.title, 'Название');
  assert.equal(context.originalTitle, 'Name');
  assert.ok(context.searchAliases.includes('Alias'));
  assert.equal(context.tmdbId, 42);
});

test('search does not pick an arbitrary TMDB id for a work with several provider titles', () => {
  const work = { providerReferences: [42, 43].map((id) => ({ provider: 'tmdb', entityKind: 'tv', value: String(id) })) };
  assert.equal(tmdbWorkId(work, 'tv'), undefined);
  assert.equal(tmdbWorkId(work, 'tv', 43), 43);
  assert.equal(tmdbWorkId(work, 'tv', 99), undefined);
});
