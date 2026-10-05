import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PotokSDK } from 'potok-sdk';
import { openItem } from '../resolve/openItem.js';
import { rememberCard, clearCardMeta } from '../data/cardMeta.js';
import { state } from '../state.js';

const META = {
  shikiId: 42,
  malId: 25113,
  kind: 'tv',
  name: 'Name',
  english: 'English',
  russian: 'Русское',
  year: 2024,
  mediaType: 'tv',
  title: 'Русское',
};

function armLayout(groups) {
  return { work: { id: 'work-1' }, graphVersion: 'v1', groups };
}

function seasonGroup(tmdbShow, tmdbSeason = 1) {
  return { id: 'g1', kind: 'season', number: 1, tmdbShow, tmdbSeason, episodes: [{ id: 'e1', number: 1 }] };
}

function stub({ navigations = [], hud = [], storageSet = [], httpCalls = [] } = {}) {
  PotokSDK.ui.navigateTo = (path) => navigations.push(path);
  PotokSDK.ui.showHUD = (type, message) => hud.push({ type, message });
  PotokSDK.storage.local.getItem = async () => null;
  PotokSDK.storage.local.setItem = async (key, value) => storageSet.push({ key, value });
  PotokSDK.storage.local.removeItem = async () => {};
  PotokSDK.http.get = async (url) => { httpCalls.push(url); throw new Error(`unexpected GET ${url}`); };
  PotokSDK.arm.resolveWork = async () => { throw new Error('unexpected resolveWork'); };
  PotokSDK.arm.getEpisodeLayout = async () => { throw new Error('unexpected getEpisodeLayout'); };
  return { navigations, hud, storageSet, httpCalls };
}

function resetPicker() {
  state.pickerOpen = false;
  state.pickerItems = [];
  state.pickerShikiId = null;
}

test('ARM hit navigates straight to the bridged TMDB page and caches the choice', async () => {
  clearCardMeta();
  resetPicker();
  const { navigations, storageSet, httpCalls } = stub();
  PotokSDK.arm.resolveWork = async () => ({ workId: 'work-1' });
  PotokSDK.arm.getEpisodeLayout = async () => armLayout([seasonGroup(12345, 2)]);

  rememberCard(META);
  await openItem({ id: META.shikiId });

  assert.deepEqual(navigations, ['/media/tv/12345']);
  assert.equal(storageSet.length, 1);
  assert.equal(storageSet[0].key, 'shiki:tmdb:42');
  assert.deepEqual(JSON.parse(storageSet[0].value), { id: 12345, mediaType: 'tv' });
  assert.deepEqual(httpCalls, []); // no title search, no detail verification on the graph path
});

test('ARM miss falls back to the TMDB title search', async () => {
  clearCardMeta();
  resetPicker();
  const { navigations } = stub();
  PotokSDK.arm.resolveWork = async () => ({ workId: null, graphVersion: 'v1' });
  PotokSDK.http.get = async (url) => {
    if (url.startsWith('/api/media/search')) {
      return { status: 200, data: JSON.stringify([{ id: 555, mediaType: 'tv', title: 'Русское' }]) };
    }
    if (url.startsWith('/api/media/detail/')) {
      return { status: 200, data: JSON.stringify({ id: 555 }) };
    }
    throw new Error(`unexpected GET ${url}`);
  };

  rememberCard(META);
  await openItem({ id: META.shikiId });

  assert.deepEqual(navigations, ['/media/tv/555']);
});

test('ARM miss with several candidates opens the picker instead of navigating', async () => {
  clearCardMeta();
  resetPicker();
  const { navigations } = stub();
  PotokSDK.arm.resolveWork = async () => ({ workId: null, graphVersion: 'v1' });
  PotokSDK.http.get = async (url) => {
    if (url.startsWith('/api/media/search')) {
      return {
        status: 200,
        data: JSON.stringify([
          { id: 555, mediaType: 'tv', title: 'Русское' },
          { id: 556, mediaType: 'tv', title: 'English' },
        ]),
      };
    }
    throw new Error(`unexpected GET ${url}`);
  };

  rememberCard(META);
  await openItem({ id: META.shikiId });

  assert.deepEqual(navigations, []);
  assert.equal(state.pickerOpen, true);
  assert.equal(state.pickerShikiId, META.shikiId);
  assert.equal(state.pickerItems.length, 2);
  resetPicker();
});

test('ARM miss with no candidates reports not found', async () => {
  clearCardMeta();
  resetPicker();
  const { navigations, hud } = stub();
  PotokSDK.arm.resolveWork = async () => ({ workId: null, graphVersion: 'v1' });
  PotokSDK.http.get = async () => ({ status: 200, data: JSON.stringify([]) });

  rememberCard(META);
  await openItem({ id: META.shikiId });

  assert.deepEqual(navigations, []);
  assert.ok(hud.some((h) => h.type === 'warning'));
});

test('a cached hit short-circuits before the graph resolve', async () => {
  clearCardMeta();
  resetPicker();
  const { navigations } = stub();
  PotokSDK.storage.local.getItem = async () => JSON.stringify({ id: 999, mediaType: 'tv' });
  PotokSDK.http.get = async (url) => {
    if (url.startsWith('/api/media/detail/')) return { status: 200, data: JSON.stringify({ id: 999 }) };
    throw new Error(`unexpected GET ${url}`);
  };
  let resolveCalled = false;
  PotokSDK.arm.resolveWork = async () => { resolveCalled = true; return { workId: 'work-1' }; };

  rememberCard(META);
  await openItem({ id: META.shikiId });

  assert.deepEqual(navigations, ['/media/tv/999']);
  assert.equal(resolveCalled, false);
});
