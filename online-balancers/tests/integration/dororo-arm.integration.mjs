import assert from 'node:assert/strict';
import test from 'node:test';

import { createOnlineBalancersClient } from '../../plugin/api/onlineBalancersClient.js';
import { createEpisodeService } from '../../plugin/episodes/episodesController.js';
import { createPlaybackService } from '../../plugin/playback/playbackController.js';
import { createSessionStore } from '../../plugin/playback/sessionStore.js';
import { groupSources } from '../../plugin/search/grouping.js';
import { mapSource } from '../../plugin/search/searchController.js';

const backendUrl = process.env.ONLINE_BALANCERS_URL || 'http://127.0.0.1:8090';
const gatewayUrl = process.env.POTOK_GATEWAY_URL || 'http://127.0.0.1:5000';

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
  getEpisodeLayout(workId) {
    return json(`${gatewayUrl}/api/arm/v1/works/${encodeURIComponent(workId)}/layout?locale=ru`);
  },
};

function firstUri(manifest) {
  return manifest.split(/\r?\n/u).map(line => line.trim()).find(line => line && !line.startsWith('#'));
}

async function fetchRealMediaBytes(streamUrl) {
  let currentUrl = streamUrl;
  for (let depth = 0; depth < 3; depth += 1) {
    const response = await fetch(currentUrl);
    assert.equal(response.ok, true, `${currentUrl} returned ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!type.includes('mpegurl') && !currentUrl.includes('.m3u8')) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert.ok(bytes.length > 100, 'resolved media response is empty');
      return;
    }
    const manifest = await response.text();
    assert.match(manifest, /#EXTM3U/u);
    const uri = firstUri(manifest);
    assert.ok(uri, 'HLS manifest has no playable URI');
    currentUrl = new URL(uri, currentUrl).toString();
  }
  assert.fail('HLS manifest nesting did not reach media bytes');
}

test('Dororo uses one ARM season, keeps provider locators and resolves real HLS media', {
  timeout: 180_000,
}, async () => {
  const context = {
    type: 'tv',
    title: 'Дороро',
    originalTitle: 'Dororo',
    year: 2019,
    tmdbId: 83100,
  };
  const client = createOnlineBalancersClient({ apiBase: backendUrl });
  const search = await client.search(context, ['aniliberty', 'animego', 'kodik']);
  const groups = groupSources((search.items || []).map(item => mapSource(item, context)));
  const group = groups.find(candidate => {
    const providers = new Set(candidate.variants.map(variant => variant.providerId));
    return providers.has('kodik') && (providers.has('aniliberty') || providers.has('animego'));
  });
  assert.ok(group, 'Dororo sources from Kodik and an anime provider were not grouped');

  const episodeService = createEpisodeService({
    client,
    arm,
    translate: (_key, values) => `Episode ${values.number}`,
  });
  const result = await episodeService.fetchGroupedEpisodes(group, context);
  assert.equal(result.arm?.state, 'resolved');
  assert.equal(result.episodes.length, 24);
  assert.deepEqual([...new Set(result.episodes.map(episode => episode.season))], [1]);

  const first = result.episodes[0];
  const providers = new Set(first.audios.map(candidate => candidate.providerId));
  assert.ok(providers.has('kodik'));
  assert.ok(providers.has('aniliberty') || providers.has('animego'));
  assert.ok(first.workId && first.entryId && first.episodeId);

  const kodik = first.audios.find(candidate => candidate.providerId === 'kodik');
  assert.ok(kodik?.locator, 'Kodik raw locator was lost during ARM canonicalization');
  const playbackService = createPlaybackService({
    client,
    episodeService,
    sessionStore: createSessionStore(),
    pluginId: 'online-balancers',
    translate: key => key,
    playVideo() {},
  });
  const candidates = [...new Map(first.audios.map(candidate => [candidate.providerId, candidate])).values()];
  let playback = null;
  const failures = [];
  for (const candidate of candidates) {
    const stream = group.variants.find(variant =>
      variant.providerId === candidate.providerId && variant.sourceId === candidate.sourceId)
      || group.variants.find(variant => variant.providerId === candidate.providerId)
      || group.variants[0];
    const selected = { ...first, selectedAudioId: candidate.id, audios: [candidate] };
    try {
      const resolved = await playbackService.resolvePlayback(stream, selected, context);
      await fetchRealMediaBytes(resolved.streamUrl);
      playback = resolved;
      break;
    } catch (error) {
      failures.push(`${candidate.providerId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  assert.ok(playback, `no provider produced real media bytes:\n${failures.join('\n')}`);
  assert.equal(playback.workId, first.workId);
  assert.equal(playback.entryId, first.entryId);
  assert.equal(playback.episodeId, first.episodeId);
});

