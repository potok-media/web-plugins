import assert from 'node:assert/strict';
import test from 'node:test';

import { createOnlineBalancersClient } from '../../plugin/api/onlineBalancersClient.js';
import { createEpisodeService } from '../../plugin/episodes/episodesController.js';
import { groupSources } from '../../plugin/search/grouping.js';
import { createSearchService } from '../../plugin/search/searchController.js';
import { sourceRegistry } from '../../plugin/sources/registry.js';

const backendUrl = process.env.ONLINE_BALANCERS_URL || 'http://127.0.0.1:8090';
const gatewayUrl = process.env.POTOK_GATEWAY_URL || 'http://127.0.0.1:5000';
const workId = '51165843-cb2b-4326-8e5a-629af80f65b5';
const alicizationEntryId = '2f99d036-1905-544a-892b-0661e18b9fe9';

async function json(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true, `${url} returned ${response.status}`);
  return response.json();
}

const arm = {
  resolveWork(reference) {
    const path = [reference.provider, reference.entityKind, reference.value]
      .map(encodeURIComponent)
      .join('/');
    return json(`${gatewayUrl}/api/arm/v1/works/resolve/${path}?locale=ru`);
  },
  getEntries(id) {
    return json(`${gatewayUrl}/api/arm/v1/works/${encodeURIComponent(id)}/entries?locale=ru`);
  },
  getEpisodeLayout(id, options) {
    const group = options?.groupId ? `&groupId=${encodeURIComponent(options.groupId)}` : '';
    return json(`${gatewayUrl}/api/arm/v1/works/${encodeURIComponent(id)}/layout?locale=ru${group}`);
  },
};

test('Sword Art Online search is cast to ARM entries before a selected arc loads episodes', {
  timeout: 180_000,
}, async () => {
  const context = {
    type: 'tv',
    title: 'Мастера меча онлайн',
    originalTitle: 'ソードアート オンライン',
    tmdbId: 45782,
    workId,
  };
  const client = createOnlineBalancersClient({ apiBase: backendUrl });
  const search = createSearchService({
    client,
    registry: sourceRegistry,
    arm,
    getLocale: () => 'ru',
  });

  const result = await search.search(context);
  assert.ok(result.items.length > 0, 'live providers returned no ARM-resolved sources');
  assert.ok(result.items.every(item => item.workId === workId && item.entryId));
  const groups = groupSources(result.items);
  assert.equal(new Set(groups.map(group => group.entryId)).size, groups.length);

  const alicization = groups.find(group => group.entryId === alicizationEntryId);
  assert.ok(alicization, 'Alicization ARM entry is absent from the live provider output');
  assert.equal(alicization.title, 'Мастера Меча Онлайн: Алисизация');
  assert.ok(alicization.variants.length > 1, 'provider variants were not nested under the ARM entry');

  const episodes = await createEpisodeService({
    client,
    arm,
    translate: (_key, values) => `Episode ${values.number}`,
  }).fetchGroupedEpisodes(alicization, context);

  assert.equal(episodes.episodes.length, 24);
  assert.deepEqual([...new Set(episodes.episodes.map(episode => episode.entryId))], [alicizationEntryId]);
  assert.deepEqual([...new Set(episodes.episodes.map(episode => episode.groupTitle))], [alicization.title]);
  assert.ok(episodes.episodes.every(episode => episode.resolutionState === 'resolved'));
});
