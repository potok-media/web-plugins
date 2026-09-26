import assert from 'node:assert/strict';
import test from 'node:test';
import { applyArmMetadata, armSearchContext } from '../utils/armMetadata.js';

const target = { episodeId: 'ep', entryId: 'group' };
const resolution = { workId: 'work', graphVersion: 'graph' };
const file = { id: 'file', resolutionState: 'resolved', targets: [target], title: 'original.mkv' };
function layout(tmdb = null) {
  return {
    work: { id: 'work', title: 'Show', titles: { official: 'Show', en: null, ru: null, original: null } },
    graphVersion: 'graph',
    groups: [{
      id: 'group', kind: 'season', number: 3, title: 'Cour 2', anilistId: 100, malId: 200,
      episodes: [{
        id: 'ep', number: 13, title: 'ARM title', overview: null, stillPath: '/arm.jpg', airDate: '2024-05-01',
        filler: { status: 'filler', confidence: 0.9, disputed: false }, tmdb,
      }],
    }],
  };
}

test('uses ARM metadata and only the validated episode TMDB coordinate for compatibility', () => {
  const [result] = applyArmMetadata([file], resolution, layout({ show: 42, season: 2, episode: 1 }), 42);
  assert.equal(result.title, 'ARM title');
  assert.equal(result.displayOrdinal, '13');
  assert.equal(result.groupTitle, 'Cour 2');
  assert.equal(result.groupKind, 'season');
  assert.equal(result.groupDisplayNumber, 3);
  assert.equal(result.season, 2);
  assert.equal(result.episode, 1);
  assert.equal(result.stillPath, '/arm.jpg');
  assert.equal(result.airDate, '2024-05-01');
  assert.equal(result.filler.status, 'filler');
});

test('canonical-only episodes keep names without synthetic TMDB coordinates', () => {
  const [result] = applyArmMetadata([file], resolution, layout(), 42);
  assert.equal(result.title, 'ARM title');
  assert.equal(result.season, undefined);
  assert.equal(result.episode, undefined);
  assert.equal(result.filler.status, 'filler');
});

test('ARM layout order changes presentation order without changing file transport or sidecars', () => {
  const makeFile = (id, entryId, episodeId) => Object.freeze({
    ...file, id, torrentHash: 'original-hash', fileName: `${id}.mkv`,
    url: `https://torrent.test/files/${id}/hls/master.m3u8?xa=4&xs=5`,
    targets: [{ entryId, episodeId }],
    audios: [{ id: 'audio', name: 'Dub', url: 'https://torrent.test/audio' }],
    headers: { 'X-Source': 'torrent' },
  });
  const main = makeFile('main-file', 'main', 'main-ep');
  const special = makeFile('special-file', 'special', 'special-ep');
  const part = makeFile('special-part', 'special', 'special-ep');
  const unmatched = Object.freeze({ id: 'unknown', resolutionState: 'unresolved', url: 'https://torrent.test/unknown' });
  const data = { work: { id: 'work', title: 'Show', titles: {} }, graphVersion: 'graph', groups: [
    { id: 'special', kind: 'specials', number: 1, title: 'Specials', anilistId: null, malId: null, episodes: [
      { id: 'special-ep', number: 24.5, title: 'TMDB special title', overview: null, stillPath: null, airDate: null,
        filler: null, tmdb: { show: 42, season: 0, episode: 7 } },
    ] },
    { id: 'main', kind: 'season', number: 1, title: 'Season 1', anilistId: null, malId: null, episodes: [
      { id: 'main-ep', number: 1, title: null, overview: null, stillPath: null, airDate: null, filler: null, tmdb: null },
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
  assert.equal(mapped[0].filler, null);
  assert.equal(mapped[2].title, 'original.mkv'); // null episode title keeps the parsed file title
  assert.equal(mapped[3], unmatched);
});

test('ignores metadata from a different work or graph', () => {
  for (const wrong of [{ work: { id: 'other' } }, { graphVersion: 'other' }]) {
    assert.deepEqual(applyArmMetadata([file], resolution, { ...layout(), ...wrong }, 42), [file]);
  }
});

test('does not borrow provider coordinates from another TMDB show or a malformed coordinate', () => {
  for (const tmdb of [
    { show: 99, season: 1, episode: 1 },
    { show: 42, season: -1, episode: 1 },
    { show: 42, season: 1, episode: 1.5 },
    { show: 0, season: 1, episode: 1 },
  ]) assert.equal(applyArmMetadata([file], resolution, layout(tmdb), 42)[0].episode, undefined);
});

test('joined files receive titles for all targets and no single-episode filler or TMDB coordinates', () => {
  const data = layout({ show: 42, season: 2, episode: 1 });
  data.groups[0].episodes.push({ id: 'ep2', number: 14, title: 'Next title', overview: null, stillPath: null,
    airDate: null, filler: { status: 'canon', confidence: 1, disputed: false }, tmdb: { show: 42, season: 2, episode: 2 } });
  const [result] = applyArmMetadata([{ ...file, targets: [target, { entryId: 'group', episodeId: 'ep2' }] }], resolution, data, 42);
  assert.equal(result.title, 'ARM title / Next title');
  assert.equal(result.displayOrdinal, '13–14');
  assert.equal(result.filler, undefined);
  assert.equal(result.season, undefined);
  assert.equal(result.episode, undefined);
});

test('files bound to an entry missing from the layout keep their own data', () => {
  const stray = { ...file, targets: [{ entryId: 'other-entry', episodeId: 'ep' }] };
  assert.deepEqual(applyArmMetadata([stray], resolution, layout(), 42), [stray]);
});

test('search uses the layout work titles and keeps every alias for relevance', () => {
  const context = armSearchContext({ title: 'Old', type: 'tv', workId: 'work', tmdbId: 42 }, {
    id: 'work', title: 'Display',
    titles: { official: 'Official', en: 'Name', ru: 'Название', original: 'Alias' },
  });
  assert.equal(context.title, 'Название');
  assert.equal(context.originalTitle, 'Name');
  assert.ok(context.searchAliases.includes('Alias'));
  assert.equal(context.tmdbId, 42);
});

test('search falls back to the work title and skips a latin name equal to it', () => {
  const context = armSearchContext({ title: 'Old', type: 'tv', workId: 'work' }, {
    id: 'work', title: 'Canonical Show',
    titles: { official: null, en: 'Canonical Show', ru: null, original: 'Completely Different Alias' },
  });
  assert.equal(context.title, 'Canonical Show');
  assert.equal(context.originalTitle, 'Completely Different Alias');
  assert.ok(context.searchAliases.includes('Canonical Show'));
});

test('search ignores a work summary of another work', () => {
  const query = { title: 'Old', type: 'tv', workId: 'work' };
  assert.equal(armSearchContext(query, { id: 'other', title: 'X', titles: {} }), query);
  assert.equal(armSearchContext(query, null), query);
});
