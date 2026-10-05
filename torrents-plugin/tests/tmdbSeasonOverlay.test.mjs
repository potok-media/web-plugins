import assert from 'node:assert/strict';
import test from 'node:test';
import { PotokSDK } from './fixtures/sdk.mjs';
import { overlayTmdbEpisodeMetadata } from '../utils/tmdbSeasonOverlay.js';

const bound = {
  id: '1', resolutionState: 'resolved', title: 'file-01.mkv',
  tmdbCoordinate: { show: 85937, season: 5, episode: 3 },
};
const boundAlt = {
  id: '2', resolutionState: 'resolved', title: 'file-02.mkv',
  tmdbCoordinate: { show: 424242, season: 1, episode: 1 },
};
const seasonPayload = {
  name: 'Тренировка столпов',
  episodes: [
    { episodeNumber: 2, name: 'Вторая серия', stillPath: '/s2.jpg', airDate: '2024-05-12' },
    { episodeNumber: 3, name: 'Третья серия', stillPath: '/s3.jpg', airDate: '2024-05-19' },
  ],
};

function mockSeason(payload = seasonPayload, status = 200) {
  const calls = [];
  PotokSDK.http.get = async (url) => {
    calls.push(url);
    return { status, data: payload };
  };
  return calls;
}

test('a bound file gets localized title, still, airDate and the season name as the group title', async () => {
  const calls = mockSeason();
  const [episode] = await overlayTmdbEpisodeMetadata([bound]);
  assert.equal(episode.title, 'Третья серия');
  assert.equal(episode.stillPath, '/s3.jpg');
  assert.equal(episode.airDate, '2024-05-19');
  assert.equal(episode.groupTitle, 'Тренировка столпов');
  assert.deepEqual(calls, [`/api/media/tmdb/tv/85937/season/5?language=${encodeURIComponent(PotokSDK.i18n.locale || "ru-RU")}`]);
});

test('unbound files pass through untouched and never trigger a fetch', async () => {
  let fetched = 0;
  PotokSDK.http.get = async () => { fetched += 1; return { status: 200, data: seasonPayload }; };
  const [file] = await overlayTmdbEpisodeMetadata([{ id: '9', resolutionState: 'unresolved', title: 'raw.mkv' }]);
  assert.equal(file.title, 'raw.mkv');
  assert.equal(fetched, 0);
});

test('a failed season fetch leaves just its episodes unoverlaid', async () => {
  mockSeason(null, 404);
  const [episode] = await overlayTmdbEpisodeMetadata([boundAlt]);
  assert.equal(episode.title, 'file-02.mkv');
  assert.equal(episode.stillPath, undefined);
});

test('an episode missing from the season payload keeps the file metadata', async () => {
  mockSeason({ name: 'Сезон', episodes: [] });
  const [episode] = await overlayTmdbEpisodeMetadata([boundAlt]);
  assert.equal(episode.title, 'file-02.mkv');
});
