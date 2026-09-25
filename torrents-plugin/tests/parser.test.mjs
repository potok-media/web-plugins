import assert from "node:assert/strict";
import test from "node:test";

import { TorrentParser } from "../utils/parser.js";

test("keeps raw seasons that are outside the TMDB season count", () => {
  const evidence = TorrentParser.parseEpisode(
    "Show/Season 7/Show.S07E03.mkv",
    "tv",
    2,
  );

  assert.equal(evidence.season, 7);
  assert.equal(evidence.episode, 3);
  assert.deepEqual(evidence.seasons, [7]);
});

test('fallback display parsing keeps long and decimal anime numbers', () => {
  assert.equal(TorrentParser.parseEpisode('One Piece - 1089.mkv', 'tv').episode, 1089);
  assert.equal(TorrentParser.parseEpisode('Show - 24.5.mkv', 'tv').episode, 24.5);
  assert.equal(TorrentParser.parseEpisode('1089.mkv', 'tv').episode, 1089);
});

test('fallback retains explicit season zero and joined range evidence', () => {
  assert.equal(TorrentParser.parseEpisode('Show.S00E01.mkv', 'tv').season, 0);
  const range = TorrentParser.parseEpisode('Show.S01E01-E02.mkv', 'tv');
  assert.equal(range.episode, 1);
  assert.equal(range.episodeEnd, 2);
});

test('fallback distinguishes credits and numeric audio/resolution noise', () => {
  assert.equal(TorrentParser.parseEpisode('NCOP 01.mkv', 'tv').kind, 'credits');
  assert.equal(TorrentParser.parseEpisode('Show 1920x1080 5.1.mkv', 'tv').episode, undefined);
  assert.equal(TorrentParser.parseEpisode('Show 1920x1080 5.1.mkv', 'tv').season, undefined);
});

test('fallback accepts Windows path separators', () => {
  assert.equal(TorrentParser.parseEpisode('Show\\Season 2\\01.mkv', 'tv').season, 2);
});
