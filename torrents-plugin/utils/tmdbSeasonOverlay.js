import { PotokSDK } from 'potok-sdk';
import { parseJson } from './http.js';

// Localized TMDB episode metadata for ARM-bound files, fetched per season through the
// gateway (never a direct TMDB call) and cached per plugin session. The graph deliberately
// carries no display metadata; every bound file's tmdbCoordinate (from applyArmMetadata)
// is the only pointer used — no name guessing, no fallbacks onto unrelated metadata.
const pending = new Map();

function loadSeason(show, seasonNumber) {
  const key = `${show}:${seasonNumber}`;
  let request = pending.get(key);
  if (!request) {
    const language = PotokSDK.i18n.locale || "ru-RU";
    request = PotokSDK.http.get(
      `/api/media/tmdb/tv/${encodeURIComponent(show)}/season/${encodeURIComponent(seasonNumber)}?language=${encodeURIComponent(language)}`,
      undefined, 15_000)
      .then((response) => (response?.status === 200 ? parseJson(response) : null))
      .catch(() => null);
    // Only successes are cached: a transient failure (gateway down) must not poison the
    // season for the rest of the session — the next getEpisodes retries.
    request.then((season) => {
      if (season) pending.set(key, Promise.resolve(season));
      else pending.delete(key);
    });
    pending.set(key, request);
  }
  return request;
}

/**
 * Overlays localized TMDB episode title/still/airDate and the localized season name onto
 * files bound to a single layout episode with a tmdb coordinate. Unbound files pass through
 * untouched; a failed season fetch leaves just its episodes unoverlaid (never fabricated).
 */
export async function overlayTmdbEpisodeMetadata(files) {
  const wanted = new Map();
  for (const file of files || []) {
    const coordinate = file.tmdbCoordinate;
    if (file.resolutionState === "resolved" && coordinate) {
      wanted.set(`${coordinate.show}:${coordinate.season}`, coordinate);
    }
  }
  if (wanted.size === 0) return files;

  const seasons = new Map();
  await Promise.all([...wanted.entries()].map(async ([key, coordinate]) => {
    seasons.set(key, await loadSeason(coordinate.show, coordinate.season));
  }));

  return (files || []).map((file) => {
    const coordinate = file.tmdbCoordinate;
    if (file.resolutionState !== "resolved" || !coordinate) return file;
    const season = seasons.get(`${coordinate.show}:${coordinate.season}`);
    if (!season) return file;
    const episode = (season.episodes || []).find((candidate) =>
      (candidate.episodeNumber ?? candidate.episode_number) === coordinate.episode);
    if (!episode) return file;
    return {
      ...file,
      title: episode.name || file.title,
      stillPath: episode.stillPath || episode.still_path || file.stillPath,
      airDate: episode.airDate || episode.air_date || file.airDate,
      groupTitle: season.name || file.groupTitle,
    };
  });
}
