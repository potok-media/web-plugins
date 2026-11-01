import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppController } from '../plugin/app/controller.js';
import { createPageState } from '../plugin/app/state.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createController(overrides = {}) {
  const state = createPageState();
  const hud = [];
  const played = [];
  let stopped = 0;
  const controller = createAppController({
    state,
    searchService: overrides.searchService || { search: async () => ({ items: [], errors: {} }) },
    episodeService: overrides.episodeService || { fetchGroupedEpisodes: async () => ({ episodes: [] }) },
    playbackService: overrides.playbackService || { play: async () => ({ streamUrl: 'stream' }) },
    ui: {
      showHUD(level, message) { hud.push({ level, message }); },
      playVideo(value) { played.push(value); },
      stopVideo() { stopped += 1; },
    },
    translate: key => key,
  });
  return { controller, state, hud, played, stopped: () => stopped };
}

test('late search response cannot overwrite a newer route', async () => {
  const first = deferred();
  const second = deferred();
  let call = 0;
  const { controller, state } = createController({
    searchService: { search: () => (++call === 1 ? first.promise : second.promise) },
  });

  controller.applyRoute({ query: { q: 'First' } });
  controller.applyRoute({ query: { q: 'Second' } });
  second.resolve({ items: [{ id: 'second' }], errors: {} });
  await second.promise;
  await new Promise(resolve => setImmediate(resolve));
  first.resolve({ items: [{ id: 'first' }], errors: {} });
  await first.promise;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(state.context.title, 'Second');
  assert.deepEqual(state.items, [{ id: 'second' }]);
});

test('closing the selector closes the complete plugin playback workspace', () => {
  const { controller, state, stopped } = createController();
  state.selectedId = 'arm:entry-1';
  state.selectedStream = { id: 'arm:entry-1' };
  state.selectedEpisodes = [{ id: 'episode-1' }];
  state.activeEpisodeId = 'episode-1';
  state.episodeSelectorOpen = true;
  state.episodeStatus = 'ready';

  controller.actions.closeEpisodeSelector();

  assert.equal(stopped(), 1);
  assert.equal(state.selectedId, '');
  assert.equal(state.selectedStream, null);
  assert.deepEqual(state.selectedEpisodes, []);
  assert.equal(state.activeEpisodeId, '');
  assert.equal(state.episodeSelectorOpen, false);
  assert.equal(state.episodeStatus, 'idle');
});

test('episode order remains page state and playback errors are surfaced', async () => {
  const group = { id: 'group', mediaType: 'tv', variants: [{ providerId: 'a', sourceId: '1' }] };
  const episodes = [{ id: '1', season: 1, episode: 1 }, { id: '2', season: 1, episode: 2 }];
  const { controller, state, hud } = createController({
    episodeService: { fetchGroupedEpisodes: async () => ({ episodes }) },
    playbackService: { play: async () => { throw new Error('playback failed'); } },
  });
  controller.applyRoute({ query: { q: 'Anime' } });
  await controller.actions.openSource(group);
  controller.actions.reorderEpisodes([...episodes].reverse());
  controller.actions.playEpisode(episodes[0]);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(state.selectedEpisodes.map(item => item.id), ['2', '1']);
  assert.equal(state.activeEpisodeId, '1');
  assert.equal(hud.at(-1).message, 'playback failed');
});

test('late episode results cannot reopen a panel after route navigation', async () => {
  const pending = deferred();
  const group = { id: 'group', mediaType: 'tv', variants: [{ providerId: 'a', sourceId: '1' }] };
  const { controller, state } = createController({
    episodeService: { fetchGroupedEpisodes: () => pending.promise },
  });
  controller.applyRoute({ query: { q: 'First' } });
  const opening = controller.actions.openSource(group);
  controller.applyRoute({ query: { q: 'Second' } });
  pending.resolve({ episodes: [{ id: '1', season: 1, episode: 1 }] });
  await opening;

  assert.equal(state.context.title, 'Second');
  assert.equal(state.episodeSelectorOpen, false);
  assert.deepEqual(state.selectedEpisodes, []);
});

test('host playlist broadcasts move the panel highlight only for the open source', () => {
  const { controller, state } = createController();
  state.selectedId = 'arm:entry-1';
  state.selectedStream = { id: 'arm:entry-1' };
  state.selectedEpisodes = [{ id: '1:1', season: 1, episode: 1 }, { id: '1:2', season: 1, episode: 2 }];
  state.activeEpisodeId = '1:1';
  state.episodeSelectorOpen = true;

  // "Дальше" in the player — the host broadcasts the new active playlist item.
  controller.actions.syncActiveEpisode({ episodeId: '1:2', playlistIndex: 1 });
  assert.equal(state.activeEpisodeId, '1:2');

  // Same value again — no-op, no re-render.
  controller.actions.syncActiveEpisode({ episodeId: '1:2', playlistIndex: 1 });
  assert.equal(state.activeEpisodeId, '1:2');

  // Unknown episode (another plugin's playback on the same host) — ignored.
  controller.actions.syncActiveEpisode({ episodeId: 'zz:9', playlistIndex: 0 });
  assert.equal(state.activeEpisodeId, '1:2');

  // Panel closed — nothing to highlight.
  state.episodeSelectorOpen = false;
  controller.actions.syncActiveEpisode({ episodeId: '1:1', playlistIndex: 0 });
  assert.equal(state.activeEpisodeId, '1:2');
});

test('host player close clears the stale panel highlight', () => {
  const { controller, state } = createController();
  state.selectedId = 'arm:entry-1';
  state.selectedStream = { id: 'arm:entry-1' };
  state.selectedEpisodes = [{ id: '1:1', season: 1, episode: 1 }];
  state.activeEpisodeId = '1:1';
  state.episodeSelectorOpen = true;

  controller.actions.clearActiveEpisode();
  assert.equal(state.activeEpisodeId, '');

  // Already cleared — no-op.
  controller.actions.clearActiveEpisode();
  assert.equal(state.activeEpisodeId, '');
});
