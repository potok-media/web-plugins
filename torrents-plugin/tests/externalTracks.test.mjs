import assert from 'node:assert/strict';
import test from 'node:test';
import { attachExternalTracks } from '../data/externalTracks.js';
import { getPlaybackInfo } from '../data/playback.js';

test('sidecar attachment keeps integer and fractional episode tracks separate', () => {
  const files = [{ id: 1, path: 'Show - 24.mkv' }, { id: 2, path: 'Show - 24.5.mkv' }];
  const audio = [{ id: 3, path: 'Dub/Show - 24.mka' }, { id: 4, path: 'Dub/Show - 24.5.mka' }];
  const result = attachExternalTracks(files, audio, [], { type: 'tv' }, { title: 'Show' });
  assert.deepEqual(result.map((file) => file.externalTracks.audio), [['3'], ['4']]);
});

test('ARM playback identity preserves external track parameters', async () => {
  const hash = 'a'.repeat(40);
  const result = await getPlaybackInfo({ hash }, {
    id: '1', episodeId: 'ep', workId: 'work', title: 'Episode',
    url: `https://torrent.test/api/torrents/${hash}/files/1/hls/master.m3u8?xa=3&xs=4`,
  }, { type: 'tv', tmdbId: 42, title: 'Show' });
  assert.match(result.streamUrl, /\?xa=3&xs=4$/);
  assert.equal(result.episodeId, 'ep');
  assert.equal(result.season, undefined);
});
