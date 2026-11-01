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
  const presented = [];
  const dismissed = [];
  let stopped = 0;
  let playCalls = [];
  const playbackService = overrides.playbackService || {
    play: async (...args) => { playCalls.push(args); return { streamUrl: 'stream' }; },
  };
  const controller = createAppController({
    state,
    searchService: overrides.searchService || { search: async () => ({ items: [], errors: {} }) },
    episodeService: overrides.episodeService || { fetchGroupedEpisodes: async () => ({ episodes: [] }) },
    playbackService,
    ui: {
      showHUD(level, message) { hud.push({ level, message }); },
      playVideo(value) { played.push(value); },
      stopVideo() { stopped += 1; },
      presentEpisodes(payload) { presented.push(payload); },
      dismissEpisodes() { dismissed.push(true); },
    },
    translate: (key, options) => (options ? `${key}:${JSON.stringify(options)}` : key),
  });
  return {
    controller,
    state,
    hud,
    played,
    presented,
    dismissed: () => dismissed.length,
    stopped: () => stopped,
    playCalls: () => playCalls,
  };
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

test('closing the selector dismisses the host episode panel and closes the plugin playback workspace', () => {
  const { controller, state, stopped, dismissed } = createController();
  state.selectedId = 'arm:entry-1';
  state.selectedStream = { id: 'arm:entry-1' };
  state.selectedEpisodes = [{ id: 'episode-1' }];
  state.activeEpisodeId = 'episode-1';
  state.episodeSelectorOpen = true;
  state.episodeStatus = 'ready';

  controller.actions.closeEpisodeSelector();

  assert.equal(dismissed(), 1);
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

test('opening a source presents episodes to the host panel and play routes back through the callback', async () => {
  const group = {
    id: 'group',
    title: 'Demo',
    mediaType: 'tv',
    voices: ['Studio'],
    qualities: ['1080'],
    year: 2024,
    variants: [{ providerId: 'a', sourceId: '1' }],
  };
  const episodes = [{ id: '1', season: 1, episode: 1 }, { id: '2', season: 1, episode: 2 }];
  const { controller, state, presented, playCalls } = createController({
    episodeService: { fetchGroupedEpisodes: async () => ({ episodes }) },
  });
  controller.applyRoute({ query: { q: 'Anime' } });
  await controller.actions.openSource(group);

  // Episodes go to the host as data — the plugin does not draw the panel itself.
  assert.equal(presented.length, 1);
  assert.equal(presented[0].title, 'Demo');
  assert.equal(presented[0].canReorder, true);
  assert.deepEqual(presented[0].episodes, episodes);
  assert.match(presented[0].subtitle, /1080/);

  // Host panel click — the host invokes the registered onPlay callback back in the plugin.
  presented[0].onPlay(episodes[1], 'audio-2');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.activeEpisodeId, '2');
  assert.equal(playCalls().length, 1);
  assert.equal(playCalls()[0][1], episodes[1]);
  assert.equal(playCalls()[0][4], '2');
});

test('reorder re-presents episodes to the host panel', async () => {
  const group = { id: 'group', mediaType: 'tv', variants: [{ providerId: 'a', sourceId: '1' }] };
  const episodes = [{ id: '1', season: 1, episode: 1 }, { id: '2', season: 1, episode: 2 }];
  const { controller, presented } = createController({
    episodeService: { fetchGroupedEpisodes: async () => ({ episodes }) },
  });
  controller.applyRoute({ query: { q: 'Anime' } });
  await controller.actions.openSource(group);
  assert.equal(presented.length, 1);

  presented[0].onReorder([...episodes].reverse());
  assert.equal(presented.length, 2);
  assert.deepEqual(presented[1].episodes.map(item => item.id), ['2', '1']);
});
