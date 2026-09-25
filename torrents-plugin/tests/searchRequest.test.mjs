import assert from "node:assert/strict";
import test from "node:test";

import { buildTorrentSearchRequest } from "../utils/searchRequest.js";

test("carries canonical work identity alongside compatibility TMDB coordinates", () => {
  const request = buildTorrentSearchRequest(
    {
      title: "Example",
      originalTitle: "Original",
      type: "tv",
      tmdbId: 42,
      workId: "0199cc63-1fd3-766a-aafb-99fc22440c76",
      season: 7,
      episode: 3,
    },
    "Original",
  );

  assert.equal(request.workId, "0199cc63-1fd3-766a-aafb-99fc22440c76");
  assert.equal(request.id, 42);
  assert.equal(request.season, undefined);
  assert.equal(request.episode, undefined);
});


test("does not invent TMDB id zero or NaN for a canonical-only work", () => {
  for (const tmdbId of [undefined, null, "", "not-an-id", 0, -1]) {
    assert.equal(buildTorrentSearchRequest({ title: "Example", type: "tv", tmdbId }).id, undefined);
  }
});
