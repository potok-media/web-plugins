import assert from 'node:assert/strict';
import test from 'node:test';
import { PotokSDK } from './fixtures/sdk.mjs';
import { getEpisodes } from '../data/episodes.js';
import { saveEpisodeBinding, clearFileOverride } from '../data/overrides.js';
import { search } from '../data/search.js';

const hash = 'a'.repeat(40);
const stream = { hash, title: 'Show Season 1' };
const context = { type: 'tv', tmdbId: 42, workId: 'work', orderingId: 'order' };
const armTarget = { workId: 'work', orderingId: 'order', groupId: 'group', episodeId: 'ep' };
const canonicalFile = { id: '1', path: 'Show/Show - 24.5.mkv', title: 'Show - 24.5.mkv', sizeBytes: 1000 };
function response(data, status = 200) { return { status, data }; }
function resolution(releaseId = hash, workId = 'work') {
  return {
    releaseId, workId, orderingId: 'order', graphVersion: 'graph', state: 'resolved',
    bindings: [{ fileId: '1', state: 'resolved', targets: [{ episodeId: 'ep', orderingId: 'order', groupId: 'group' }], evidence: { episode: 24.5 }, confidence: 1 }],
  };
}
function layout(workId = 'work') {
  return {
    workId, ordering: { id: 'order' }, graphVersion: 'graph', groups: [{
      id: 'group', kind: 'specials', displayTitle: { value: 'Specials' }, episodes: [{
        id: 'ep', ordinal: '24.5', displayTitle: { value: 'Canonical special' },
        providerReferences: [{ provider: 'tmdb', entityKind: 'tv-episode', value: '42/0/7' }],
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
  assert.equal(manifest.orderingId, 'order');
  assert.deepEqual(manifest.fileOverrides['1'].armTarget, armTarget);
  assert.deepEqual(manifest.sectionOverrides, { _: { season: 2, offset: -12 } });
  assert.equal(manifest.files[0].path, canonicalFile.path);
  assert.equal(manifest.files[0].rawEvidence, undefined);
  assert.equal(result.episodes[0].episodeId, 'ep');
  assert.equal(result.episodes[0].rawEpisode, 24.5);
  assert.equal(result.episodes[0].title, 'Canonical special');
  assert.equal(result.episodes[0].season, 0);
  assert.equal(result.episodes[0].episode, 7);
  assert.equal(result.episodes[0].displayOrdinal, '24.5');
  assert.ok(calls.some((call) => call.url.includes('/layout?') && call.url.includes('locale=ru')));
  assert.ok(calls.every((call) => !call.url.includes('/api/media/')));
  await clearFileOverride(stream, context, '1');
  assert.deepEqual(saved, {});
});

test('ARM outage keeps original files playable without trusting a saved canonical target', async () => {
  mockEpisodeTransport({ unavailable: true, saved: { 1: { mode: 'pin', armTarget, season: null, episode: null } } });
  const result = await getEpisodes(stream, context);
  assert.equal(result.episodes.length, 1);
  assert.match(result.episodes[0].url, /files\/1\/hls\/master.m3u8$/);
  assert.equal(result.episodes[0].episodeId, null);
  assert.deepEqual(result.episodes[0].targets, []);
  assert.equal(result.episodes[0].resolutionState, 'unresolved');
  assert.equal(result.episodes[0].season, undefined);
  assert.equal(result.episodes[0].episode, undefined);
  assert.equal(result.arm, null);
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

test('manual mapping rejects wrong work or scope before writing', async () => {
  const calls = mockEpisodeTransport();
  await assert.rejects(saveEpisodeBinding(stream, context, { fileId: '1', mode: 'pin', armTarget: { ...armTarget, workId: 'other' } }));
  await assert.rejects(saveEpisodeBinding(stream, context, { fileId: '1', mode: 'anchor', armTarget, scopeFileIds: ['2'] }));
  assert.deepEqual(calls, []);
});

test('search reads ARM names but does not discard a canonical group using legacy season heuristics', async () => {
  const posted = [];
  PotokSDK.http.get = async () => response({ work: {
    id: 'work', displayTitle: { value: 'Canonical Show' }, names: [
      { value: 'Canonical Show', locale: 'en', role: 'official' },
      { value: 'Completely Different Alias', role: 'alias' },
    ], providerReferences: [{ provider: 'tmdb', entityKind: 'tv', value: '42' }],
  } });
  PotokSDK.http.streamPost = async (_url, body, _headers, _timeout, progress) => {
    posted.push(body);
    progress({ type: 'batch', results: [{ id: hash, title: 'Completely Different Alias S07E01' }] });
    return response(null);
  };
  const result = await search({ ...context, title: 'Old Name', season: 2, groupId: 'group' });
  assert.equal(posted[0].title, 'Canonical Show');
  assert.equal(posted[0].season, undefined);
  assert.equal(result.length, 1);
  assert.equal(result[0].season, 7);
});

test('concurrent search contexts keep their own work metadata', async () => {
  let releaseFirst;
  const delayed = new Promise((resolve) => { releaseFirst = resolve; });
  PotokSDK.http.get = async (url) => {
    const workId = url.endsWith('/first') ? 'first' : 'second';
    if (workId === 'first') await delayed;
    return response({ work: { id: workId, displayTitle: { value: `${workId} title` }, names: [], providerReferences: [] } });
  };
  const posted = [];
  PotokSDK.http.streamPost = async (_url, body) => { posted.push(body); return response(null); };
  const first = search({ title: 'old', type: 'tv', workId: 'first' });
  await search({ title: 'old', type: 'tv', workId: 'second' });
  releaseFirst();
  await first;
  assert.deepEqual(posted.map((body) => [body.workId, body.title]), [['second', 'second title'], ['first', 'first title']]);
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
    workId: 'work', orderingId: 'order', groupId: 'group', displayOrdinal: '13–14', groupTitle: 'Cour 2',
  }, context);
  assert.equal(result.episodeId, null);
  assert.deepEqual(result.episodeIds, ['ep', 'ep2']);
  assert.deepEqual(result.targets, targets);
  assert.equal(result.season, undefined);
  assert.equal(result.episode, undefined);
  assert.doesNotMatch(result.title, /S1E1/);
  assert.match(result.title, /Cour 2 · 13–14/);
});
