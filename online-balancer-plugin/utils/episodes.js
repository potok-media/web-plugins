import { PotokSDK } from 'potok-sdk';
import { fetchVideoDBEpisodes } from './episodes/videodb.js';
import { fetchLiftEpisodes } from './episodes/lift.js';
import { fetchKinotochkaEpisodes } from './episodes/kinotochka.js';

export async function fetchOnlineEpisodes(activeProvider, mediaItem) {
  let parsedFiles = [];
  const mediaId = mediaItem.id;
  const progress = mediaItem.progress;

  const checkWatched = (s, ep) => {
    if (!progress || !progress.watchedEpisodes) return false;
    return progress.watchedEpisodes.some(
      (we) => we.season === s && we.number === ep
    );
  };

  // Delegate episode fetching to modular provider modules
  if (activeProvider === "videodb") {
    parsedFiles = await fetchVideoDBEpisodes(mediaId, checkWatched).catch(() => []);
  } else if (activeProvider === "lift") {
    parsedFiles = await fetchLiftEpisodes(mediaId, checkWatched).catch(() => []);
  } else if (activeProvider === "kinotochka") {
    parsedFiles = await fetchKinotochkaEpisodes(mediaId, checkWatched).catch(() => []);
  }

  if (parsedFiles.length === 0) {
    return [];
  }

  // 4. Dynamic TMDb Season count retrieval
  let tmdbSeasonCount = mediaItem.numberOfSeasons;
  if (!tmdbSeasonCount) {
    try {
      const detailsRes = await PotokSDK.http.get(`/api/media/detail/tv/${mediaId}`);
      if (detailsRes && detailsRes.status === 200) {
        const details = typeof detailsRes.data === 'string' ? JSON.parse(detailsRes.data) : detailsRes.data;
        tmdbSeasonCount = details.numberOfSeasons || 1;
      }
    } catch (err) {
      console.warn("[Plugin] Failed to fetch TMDb media details for season count:", err);
      tmdbSeasonCount = 1;
    }
  }
  const maxValidSeason = tmdbSeasonCount;

  // 5. Automated dynamic season mapping & episode merging logic
  const seasonEpisodeCounts = {};
  parsedFiles.forEach((file) => {
    const s = file.season;
    seasonEpisodeCounts[s] = (seasonEpisodeCounts[s] || 0) + 1;
  });

  const balancerSeasons = Object.keys(seasonEpisodeCounts)
    .map(Number)
    .sort((a, b) => a - b);

  // Group raw seasons by TMDb target season (caps at maxValidSeason)
  const targetSeasonToBalancerSeasons = {};
  balancerSeasons.forEach((s) => {
    const targetSeason = s > maxValidSeason ? maxValidSeason : s;
    if (!targetSeasonToBalancerSeasons[targetSeason]) {
      targetSeasonToBalancerSeasons[targetSeason] = [];
    }
    targetSeasonToBalancerSeasons[targetSeason].push(s);
  });

  // Calculate episode offsets sequentially per target season
  const balancerSeasonOffsets = {};
  Object.keys(targetSeasonToBalancerSeasons).forEach((targetStr) => {
    const targetSeason = Number(targetStr);
    const rawSeasons = targetSeasonToBalancerSeasons[targetSeason];
    let currentOffset = 0;
    rawSeasons.forEach((s) => {
      balancerSeasonOffsets[s] = currentOffset;
      currentOffset += seasonEpisodeCounts[s];
    });
  });

  // 6. Apply the automatic season-mapping offsets (target season + sequential episode offset). Online balancers
  //    are their own source type — no torrent overrides here.
  const refinedFiles = parsedFiles.map((file) => {
    const rawSeason = file.season;
    const finalSeason = rawSeason > maxValidSeason ? maxValidSeason : rawSeason;
    const finalEpisode = file.episode + (balancerSeasonOffsets[rawSeason] || 0);
    return {
      ...file,
      season: finalSeason,
      episode: finalEpisode,
      isWatched: checkWatched(finalSeason, finalEpisode)
    };
  });

  // 7. Pull TMDb metadata (titles, stillPaths, airDates) only for existant TMDb seasons
  if (refinedFiles.length > 0) {
    const seasonsToFetch = Array.from(new Set(refinedFiles.map((f) => f.season))).filter(Boolean);
    const metadataMap = {};

    await Promise.all(seasonsToFetch.map(async (sNum) => {
      try {
        const res = await PotokSDK.http.get(`/api/media/tmdb/tv/${mediaId}/season/${sNum}`);
        if (res && res.status === 200) {
          const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          if (data && data.episodes) {
            data.episodes.forEach((ep) => {
              const epNum = ep.episodeNumber || ep.episode_number || 1;
              const stillPath = ep.stillPath || (ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : "");
              metadataMap[`${sNum}:${epNum}`] = {
                name: ep.name,
                stillPath,
                airDate: ep.airDate || ep.air_date,
              };
            });
          }
        }
      } catch (err) {
        console.warn("[Plugin] Failed to fetch TMDB season metadata:", sNum, err);
      }
    }));

    // Attach TMDB metadata to refinedFiles
    refinedFiles.forEach((file) => {
      const meta = metadataMap[`${file.season}:${file.episode}`];
      if (meta) {
        file.title = meta.name || file.title;
        file.stillPath = meta.stillPath;
        file.airDate = meta.airDate;
      }
    });
  }

  refinedFiles.sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    return a.episode - b.episode;
  });

  return refinedFiles;
}
