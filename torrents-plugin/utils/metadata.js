import { PotokSDK } from 'potok-sdk';
import { parseJson } from './http.js';
import { logger } from './logger.js';

/**
 * Fetch TMDB episode stills, actual names, and air dates to normalize file lists beautifully!
 */
export async function applyTMDBMetadata(epList, mediaId, mediaType) {
  if (epList.length === 0 || mediaType !== "tv") return epList;
  const seasonsToFetch = Array.from(new Set(epList.map((f) => f.season))).filter(Boolean);
  const metadataMap = {};

  try {
    await Promise.all(seasonsToFetch.map(async (sNum) => {
      try {
        const res = await PotokSDK.http.get(`/api/media/tmdb/tv/${mediaId}/season/${sNum}`);
        if (res && res.status === 200) {
          const data = parseJson(res);
          if (data && data.episodes) {
            data.episodes.forEach((ep) => {
              const epNum = ep.episodeNumber || ep.episode_number || 1;
              const stillPath = ep.stillPath || (ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : "");
              metadataMap[`${sNum}:${epNum}`] = {
                name: ep.name,
                stillPath,
                airDate: ep.airDate || ep.air_date
              };
            });
          }
        }
      } catch (err) {
        logger.warn("Failed to fetch TMDB metadata for season:", sNum, err);
      }
    }));

    return epList.map((f) => {
      const meta = metadataMap[`${f.season}:${f.episode}`];
      return {
        ...f,
        title: meta ? `${f.episode}. ${meta.name}` : f.title,
        stillPath: meta?.stillPath || f.stillPath,
        airDate: meta?.airDate || f.airDate
      };
    });
  } catch (err) {
    logger.warn("Failed to apply TMDB metadata:", err);
    return epList;
  }
}
