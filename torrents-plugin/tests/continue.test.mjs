import assert from 'node:assert/strict';
import test from 'node:test';
import { PotokSDK } from './fixtures/sdk.mjs';
import { applyProgressPayload, listContinueCursors, hydrateFromSearchEngine, toContentItem } from '../data/continue.js';
import { normalizeCursor, toApiBody } from '../utils/continueCursor.js';

const work = '10000000-0000-0000-0000-000000000001';
const other = '20000000-0000-0000-0000-000000000002';
const episodeId = '30000000-0000-0000-0000-000000000003';
const entryId = '40000000-0000-0000-0000-000000000004';
const hash = 'a'.repeat(40);
let ledger, posted;
function setup() {
  ledger = {}; posted = [];
  PotokSDK.storage.local.getItem = () => JSON.stringify(ledger);
  PotokSDK.storage.local.setItem = (_key, value) => { ledger = JSON.parse(value); };
  PotokSDK.http.post = async (url, body) => { posted.push({ url, body }); return { status: 200, data: { success: true } }; };
  PotokSDK.http.get = async () => ({ status: 200, data: { items: [] } });
}
function payload(workId = work) {
  return { providerId: 'potok-torrents', id: 0, workId, episodeId, entryId,
    streamHash: hash, fileIndex: '7', title: 'Example', progressSeconds: 120, durationSeconds: 1400 };
}

test('canonical-only works save separate cursors and canonical episode context', async () => {
  setup();
  applyProgressPayload(payload());
  applyProgressPayload(payload(other));
  await new Promise(setImmediate);
  assert.equal(listContinueCursors().length, 2);
  assert.equal(ledger[work].episodeId, episodeId);
  assert.equal(ledger[work].entryId, entryId);
  assert.equal(toContentItem(ledger[work]).id, work);
  assert.equal(posted.length, 2);
  for (const { body } of posted) {
    assert.equal(body.tmdbId, undefined);
    assert.equal(body.episodeId, episodeId);
  }
  applyProgressPayload({ ...payload(), isCompleted: true });
  await new Promise(setImmediate);
  assert.deepEqual(listContinueCursors().map(c => c.workId), [other]);
  assert.deepEqual(posted.at(-1).body, { workId: work });
});

test('server hydration preserves newer local progress', async () => {
  setup(); applyProgressPayload(payload());
  PotokSDK.http.get = async () => ({ status: 200, data: { items: [{
    ...ledger[work], progressSeconds: 20, updatedAt: new Date(Date.now() - 5000).toISOString(),
  }] } });
  await hydrateFromSearchEngine();
  assert.equal(listContinueCursors()[0].progressSeconds, 120);
});

test('legacy TMDB cursors are discarded without metadata resolution or upload', async () => {
  setup();
  const updatedAt = Date.now() - 5000;
  ledger = { 'tv:42': { tmdbId: 42, mediaType: 'tv', stream: { hash }, fileIndex: '7', updatedAt, progressSeconds: 80 },
    'tv:99': { tmdbId: 99, mediaType: 'tv', stream: { hash }, fileIndex: '1', updatedAt } };
  const calls = [];
  PotokSDK.http.get = async (url) => {
    calls.push(url);
    return { status: 200, data: { items: [] } };
  };
  await hydrateFromSearchEngine();
  assert.deepEqual(ledger, {});
  assert.deepEqual(listContinueCursors(), []);
  assert.deepEqual(calls, ['https://search.test/api/v1/torrents/continue']);
  assert.deepEqual(posted, []);
});

test('invalid identities are rejected and normalization retains ARM fields', () => {
  setup(); applyProgressPayload({ ...payload(), workId: '00000000-0000-0000-0000-000000000000' });
  assert.deepEqual(ledger, {});
  const cursor = normalizeCursor({ WorkId: work, EpisodeId: episodeId, EntryId: entryId, FileIndex: '7', Stream: { hash } });
  assert.equal(toApiBody(cursor).episodeId, episodeId);
  assert.equal(cursor.entryId, entryId);
});
