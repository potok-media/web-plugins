import assert from 'node:assert/strict';
import test from 'node:test';
import { PotokSDK } from './fixtures/sdk.mjs';
import { getEpisodes } from '../data/episodes.js';
import { saveEpisodeBinding, clearFileOverride } from '../data/overrides.js';
import { search } from '../data/search.js';

const hash = 'a'.repeat(40);
const stream = { hash, title: 'Show Season 1' };
const context = { type: 'tv', tmdbId: 42, workId: 'work' };
const armTarget = { workId: 'work', entryId: 'group', episodeId: 'ep' };
const canonicalFile = { id: '1', path: 'Show/Show - 24.5.mkv', title: 'Show - 24.5.mkv', sizeBytes: 1000 };
function response(data, status = 200) { return { status, data }; }
function resolution(releaseId = hash, workId = 'work') {
  return {
    releaseId, workId, graphVersion: 'graph', state: 'resolved',
    bindings: [{ fileId: '1', state: 'resolved', targets: [{ episodeId: 'ep', entryId: 'group' }], evidence: { episode: 24.5 }, confidence: 1 }],
  };
}
function layout(workId = 'work') {
  return {
    work: { id: workId, title: 'Show', titles: { official: 'Show', en: null, ru: null, original: null } },
    graphVersion: 'graph',
    groups: [{
      id: 'group', kind: 'specials', number: 1, title: 'Specials', anilistId: null, malId: null,
      episodes: [{
        id: 'ep', number: 24.5, title: 'Canonical special', overview: null, stillPath: null, airDate: null,
        filler: { status: 'filler', confidence: 0.95, disputed: false }, tmdb: { show: 42, season: 0, episode: 7 },
      }],
    }],
  };
}

function mockEpisodeTransport({ saved = {}, unavailable = false, resolve = resolution, layoutWork = 'work' } = {}) {
  const calls = [];
  PotokSDK.http.get = async (url) => {
    calls.push({ method: 'get', url });
    if (url.includes('/overrides/')) return response({ seasonMap: { _: { season: 2, offset: -12 } }, fileMap: saved });
    if (url.includes('/layout?')) return response(layout(layoutWork));
    throw new Error(`Unexpected metadata call ${url}`);
  };
  PotokSDK.http.post = async (url, body) => {
    calls.push({ method: 'post', url, body });
    if (url === 'https://torrent.test/api/torrents') return response({ hash, items: [canonicalFile] });
    if (url.endsWith('/file/remove?fileId=1')) { delete saved['1']; return response({ success: true }); }
    if (url.endsWith('/file')) { saved[body.fileId] = { ...body }; delete saved[body.fileId].fileId; return response({ success: true }); }
    if (url === '/api/arm/v1/releases/resolve') {
      if (unavailable) throw new Error('ARM unavailable');
      return response(resolve(body.releaseId));
    }
    throw new Error(`Unexpected POST ${url}`);
  };
  return calls;
}

test('save canonical scoped anchor, reload manifest and clear preserve the chosen placement', async () => {
  const saved = {};
  const calls = mockEpisodeTransport({ saved });
  await saveEpisodeBinding(stream, context, { fileId: '1', mode: 'anchor', armTarget, scopeFileIds: ['1'] });
  assert.deepEqual(saved['1'], { season: null, episode: null, mode: 'anchor', armTarget, scopeFileIds: ['1'] });
  const result = await getEpisodes(stream, context);
  const manifest = calls.find((call) => call.url === '/api/arm/v1/releases/resolve').body;
  assert.ok(!Object.hasOwn(manifest, 'orderingId'));
  // Overrides are the SearchEngine's contract: the manifest stays structure-only, the
  // Gateway never sees them; the plugin applies them over its own layout.
  assert.ok(!Object.hasOwn(manifest, 'fileOverrides'));
  assert.ok(!Object.hasOwn(manifest, 'sectionOverrides'));
  assert.equal(manifest.files[0].path, canonicalFile.path);
  assert.equal(manifest.files[0].rawEvidence, undefined);
  assert.equal(result.episodes[0].episodeId, 'ep');
  assert.equal(result.episodes[0].entryId, 'group');
  assert.equal(result.episodes[0].rawEpisode, 24.5);
  assert.equal(result.episodes[0].title, 'Canonical special');
  assert.equal(result.episodes[0].season, 0);
  assert.equal(result.episodes[0].episode, 7);
  assert.equal(result.episodes[0].displayOrdinal, '24.5');
  assert.equal(result.episodes[0].groupKind, 'specials');
  assert.equal(result.episodes[0].filler.status, 'filler');
  assert.ok(calls.some((call) => call.url.includes('/layout?') && call.url.includes('locale=ru')));
  assert.ok(calls.every((call) => !call.url.includes('/api/media/') || call.url.includes('/api/media/tmdb/tv/')));
  await clearFileOverride(stream, context, '1');
  assert.deepEqual(saved, {});
});

test('a resolve outage does not cost the saved canonical target when the layout is live', async () => {
  // The override is applied against a freshly fetched layout (workId and the target episode
  // are verified right now) — it is never trusted blindly, but a dead resolve endpoint does
  // not strip the user's explicit binding either.
  mockEpisodeTransport({ unavailable: true, saved: { 1: { mode: 'pin', armTarget, season: null, episode: null } } });
  const result = await getEpisodes(stream, context);
  assert.equal(result.episodes.length, 1);
  assert.match(result.episodes[0].url, /files\/1\/hls\/master.m3u8$/);
  assert.equal(result.episodes[0].episodeId, 'ep');
  assert.equal(result.episodes[0].entryId, 'group');
  assert.deepEqual(result.episodes[0].targets, [{ entryId: armTarget.entryId, episodeId: armTarget.episodeId }]);
  assert.equal(result.episodes[0].resolutionState, 'resolved');
  assert.equal(result.episodes[0].season, 0);
  assert.equal(result.episodes[0].episode, 7);
});

test('response for another work or release never leaks canonical identity', async () => {
  for (const resolve of [() => resolution('other'), () => resolution(hash, 'other-work')]) {
    mockEpisodeTransport({ resolve });
    const result = await getEpisodes(stream, context);
    assert.equal(result.episodes[0].episodeId, null);
  }
});

test('layout from a changed context cannot overwrite a correctly bound file title', async () => {
  mockEpisodeTransport({ layoutWork: 'other-work' });
  const result = await getEpisodes(stream, context);
  assert.equal(result.episodes[0].title, canonicalFile.title);
  assert.equal(result.episodes[0].episodeId, 'ep');
  assert.equal(result.episodes[0].season, undefined);
});

test('manual mapping rejects wrong work, scope or a target without entryId before writing', async () => {
  const calls = mockEpisodeTransport();
  await assert.rejects(saveEpisodeBinding(stream, context, { fileId: '1', mode: 'pin', armTarget: { ...armTarget, workId: 'other' } }));
  await assert.rejects(saveEpisodeBinding(stream, context, { fileId: '1', mode: 'anchor', armTarget, scopeFileIds: ['2'] }));
  await assert.rejects(saveEpisodeBinding(stream, context, { fileId: '1', mode: 'pin', armTarget: { workId: 'work', episodeId: 'ep' } }));
  assert.deepEqual(calls, []);
});

test('search forwards host catalogue titles without an ARM metadata request or numeric season restriction', async () => {
  PotokSDK.http.get = async (url) => { throw new Error(`Unexpected metadata request ${url}`); };
  const posted = [];
  PotokSDK.http.streamPost = async (_url, body, _headers, _timeout, progress) => {
    posted.push(body);
    progress({ type: 'batch', results: [{ id: hash, title: 'Completely Different Alias S07E01' }] });
    return response(null);
  };
  const result = await search({ ...context, title: 'Canonical Show',
    searchAliases: ['Completely Different Alias'], year: 2023, season: 2 });
  assert.equal(posted[0].title, 'Canonical Show');
  assert.deepEqual(posted[0].aliases, ['Canonical Show', 'Completely Different Alias']);
  assert.equal(posted[0].year, '2023');
  assert.equal(posted[0].id, undefined);
  assert.equal(posted[0].season, undefined);
  assert.equal(result.length, 1);
  assert.equal(result[0].season, 7);
});

test('concurrent searches retain the metadata supplied for each work', async () => {
  PotokSDK.http.get = async () => { throw new Error('Search must use the supplied metadata'); };
  const posted = [];
  PotokSDK.http.streamPost = async (_url, body) => { posted.push(body); return response(null); };
  await Promise.all([
    search({ title: 'first title', searchAliases: ['first alias'], type: 'tv', workId: 'first' }),
    search({ title: 'second title', searchAliases: ['second alias'], type: 'tv', workId: 'second' }),
  ]);
  assert.deepEqual(posted.map((body) => [body.workId, body.title, body.aliases]), [
    ['first', 'first title', ['first title', 'first alias']],
    ['second', 'second title', ['second title', 'second alias']],
  ]);
});

test('older SDK without streaming HTTP still performs the buffered search', async () => {
  delete PotokSDK.http.streamPost;
  PotokSDK.http.post = async (url) => {
    assert.equal(url, 'https://search.test/api/v1/torrents/search');
    return response({ results: [{ id: hash, title: 'Show S01' }] });
  };
  assert.equal((await search({ title: 'Show', type: 'tv', tmdbId: 42 })).length, 1);
});

test('playback preserves canonical joined targets and never fabricates S1E1', async () => {
  const { getPlaybackInfo } = await import('../data/playback.js');
  const targets = [armTarget, { ...armTarget, episodeId: 'ep2' }];
  const result = await getPlaybackInfo(stream, {
    id: '1', title: 'Joined file', episodeId: null, episodeIds: ['ep', 'ep2'], targets,
    workId: 'work', entryId: 'group', displayOrdinal: '13–14', groupTitle: 'Cour 2',
  }, context);
  assert.equal(result.episodeId, null);
  assert.deepEqual(result.episodeIds, ['ep', 'ep2']);
  assert.deepEqual(result.targets, targets);
  assert.equal(result.entryId, 'group');
  assert.equal(result.season, undefined);
  assert.equal(result.episode, undefined);
  assert.doesNotMatch(result.title, /S1E1/);
  assert.match(result.title, /Cour 2 · 13–14/);
});
