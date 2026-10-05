import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PotokSDK } from 'potok-sdk';
import { pickOpenTarget, resolveArmOpen } from '../resolve/armNav.js';

function group(overrides) {
  return {
    id: 'g1',
    kind: 'season',
    number: 1,
    tmdbShow: 100,
    tmdbSeason: 1,
    episodes: [{ id: 'e1', number: 1 }],
    ...overrides,
  };
}

test('pickOpenTarget prefers season over sides/movie/ova/specials', () => {
  const target = pickOpenTarget([
    group({ id: 'ova', kind: 'ova', number: 1, tmdbShow: 400, tmdbSeason: 0 }),
    group({ id: 'movie', kind: 'movie', number: 1, tmdbShow: 300, tmdbSeason: null }),
    group({ id: 'season', kind: 'season', number: 2, tmdbShow: 100, tmdbSeason: 2 }),
    group({ id: 'sides', kind: 'sides', number: 1, tmdbShow: 200, tmdbSeason: 1 }),
  ]);
  assert.equal(target.id, 'season');
});

test('pickOpenTarget picks the lowest number inside one kind', () => {
  const target = pickOpenTarget([
    group({ id: 's2', kind: 'season', number: 2 }),
    group({ id: 's1', kind: 'season', number: 1 }),
  ]);
  assert.equal(target.id, 's1');
});

test('pickOpenTarget skips groups without a TMDB bridge or without episodes', () => {
  const target = pickOpenTarget([
    group({ id: 'no-tmdb', kind: 'season', number: 1, tmdbShow: null, tmdbSeason: null }),
    group({ id: 'empty', kind: 'season', number: 2, episodes: [] }),
    group({ id: 'ok', kind: 'sides', number: 1 }),
  ]);
  assert.equal(target.id, 'ok');
  assert.equal(pickOpenTarget([group({ tmdbShow: null, tmdbSeason: null })]), null);
  assert.equal(pickOpenTarget([]), null);
  assert.equal(pickOpenTarget(null), null);
});

test('resolveArmOpen returns null without malId and never touches the graph', async () => {
  let called = false;
  PotokSDK.arm.resolveWork = async () => { called = true; return { workId: 'w' }; };
  assert.equal(await resolveArmOpen({ malId: null }), null);
  assert.equal(await resolveArmOpen({}), null);
  assert.equal(called, false);
});

test('resolveArmOpen resolves a tv hit through resolve + layout', async () => {
  const calls = [];
  PotokSDK.arm.resolveWork = async (ref) => {
    calls.push(ref);
    return { workId: 'work-1', graphVersion: 'v1' };
  };
  PotokSDK.arm.getEpisodeLayout = async (workId) => {
    calls.push(workId);
    return { work: { id: 'work-1' }, graphVersion: 'v1', groups: [group({ tmdbShow: 12345, tmdbSeason: 2 })] };
  };

  const hit = await resolveArmOpen({ malId: 25113 });
  assert.deepEqual(hit, { id: 12345, mediaType: 'tv' });
  assert.deepEqual(calls[0], { provider: 'mal', entityKind: 'anime', value: '25113' });
  assert.equal(calls[1], 'work-1');
});

test('resolveArmOpen maps a group without a TMDB season to a movie hit', async () => {
  PotokSDK.arm.resolveWork = async () => ({ workId: 'work-1' });
  PotokSDK.arm.getEpisodeLayout = async () => ({
    work: { id: 'work-1' },
    graphVersion: 'v1',
    groups: [group({ kind: 'movie', number: 1, tmdbShow: 777, tmdbSeason: null })],
  });

  assert.deepEqual(await resolveArmOpen({ malId: 1 }), { id: 777, mediaType: 'movie' });
});

test('resolveArmOpen returns null on a resolve miss', async () => {
  PotokSDK.arm.resolveWork = async () => ({ workId: null, graphVersion: 'v1' });
  let layoutCalled = false;
  PotokSDK.arm.getEpisodeLayout = async () => { layoutCalled = true; return null; };

  assert.equal(await resolveArmOpen({ malId: 999999 }), null);
  assert.equal(layoutCalled, false);
});

test('resolveArmOpen degrades to null on graph errors and unbridged layouts', async () => {
  PotokSDK.arm.resolveWork = async () => { throw new Error('gateway down'); };
  assert.equal(await resolveArmOpen({ malId: 1 }), null);

  PotokSDK.arm.resolveWork = async () => ({ workId: 'work-1' });
  PotokSDK.arm.getEpisodeLayout = async () => { throw new Error('boom'); };
  assert.equal(await resolveArmOpen({ malId: 1 }), null);

  PotokSDK.arm.getEpisodeLayout = async () => ({
    work: { id: 'work-1' },
    graphVersion: 'v1',
    groups: [group({ tmdbShow: null, tmdbSeason: null })],
  });
  assert.equal(await resolveArmOpen({ malId: 1 }), null);
});
