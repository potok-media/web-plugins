import { PotokSDK } from 'potok-sdk';
import { parseJson } from '../utils/http.js';
import { streamHash } from '../utils/hash.js';
import { resolveSearchEngineUrl } from '../utils/config.js';

// TMDB seasons + episodes (used by the season-override editor to pick the correct mapping).
export async function getSeasonsMetadata(stream, context) {
  const detailRes = await PotokSDK.http.get(`/api/media/detail/${context.type === "tv" ? "tv" : "movie"}/${context.tmdbId}`);
  const totalSeasons = (parseJson(detailRes) || {}).numberOfSeasons || 1;

  // Start at 0 so specials (TMDB season/0) can be picked as an override target. Seasons with no episodes
  // (404 → empty) are skipped by the picker UI, so a show without specials just won't render a season-0 group.
  const promises = [];
  for (let i = 0; i <= totalSeasons; i++) {
    promises.push(
      PotokSDK.http.get(`/api/media/tmdb/tv/${context.tmdbId}/season/${i}`)
        .then(parseJson)
        .catch(() => ({ seasonNumber: i, episodes: [] }))
    );
  }
  return Promise.all(promises);
}

// Upsert ONE source-season's mapping into the SearchEngine per-season override. sourceSeason may be null (the
// sentinel bucket for files with no parseable season). offset is computed by the UI on RAW parsed episodes.
export async function saveSeasonOverride(stream, context, sourceSeason, targetSeason, offset) {
  const searchEngineUrl = await resolveSearchEngineUrl();
  if (!searchEngineUrl) {
    throw new Error(PotokSDK.i18n.t("potok-torrents:errors.noSearchUrl"));
  }
  const hash = streamHash(stream);
  const res = await PotokSDK.http.post(`${searchEngineUrl}/api/v1/torrents/overrides/${hash}/season`, {
    sourceSeason: sourceSeason === undefined ? null : sourceSeason,
    targetSeason,
    offset
  });
  if (res.status !== 200) {
    throw new Error(`Save override failed with status ${res.status}`);
  }
}

// Reset ONE source season's override (delete the entry → that season falls back to auto-parse).
export async function clearSeasonOverride(stream, context, sourceSeason) {
  const searchEngineUrl = await resolveSearchEngineUrl();
  if (!searchEngineUrl) {
    throw new Error(PotokSDK.i18n.t("potok-torrents:errors.noSearchUrl"));
  }
  const hash = streamHash(stream);
  const q = (sourceSeason === undefined || sourceSeason === null) ? "" : `?sourceSeason=${encodeURIComponent(sourceSeason)}`;
  const res = await PotokSDK.http.post(`${searchEngineUrl}/api/v1/torrents/overrides/${hash}/season/remove${q}`, {});
  if (res.status !== 200) {
    throw new Error(`Reset override failed with status ${res.status}`);
  }
}
