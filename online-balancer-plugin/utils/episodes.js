import { parsePlayerJSFile } from './parser.js';
import { PotokSDK } from '../sdk.js';

export async function fetchOnlineEpisodes(activeProvider, mediaItem) {
  const parsedFiles = [];
  const mediaId = mediaItem.id;
  const progress = mediaItem.progress;

  const checkWatched = (s, ep) => {
    if (!progress || !progress.watchedEpisodes) return false;
    return progress.watchedEpisodes.some(
      (we) => we.season === s && we.number === ep
    );
  };

  // Get local override offset if exists
  const deterministicHash = `online:${activeProvider}:${mediaId}`;
  let override = null;
  try {
    // Query local BFF API for overrides using the correct controller endpoint
    const overrideRes = await PotokSDK.http.get(`/api/media/override/${encodeURIComponent(deterministicHash)}`).catch(() => null);
    if (overrideRes && overrideRes.status === 200) {
      const data = typeof overrideRes.data === 'string' ? JSON.parse(overrideRes.data) : overrideRes.data;
      if (data) {
        override = {
          season: data.season ?? data.Season,
          episodeOffset: data.episodeOffset ?? data.EpisodeOffset ?? 0
        };
      }
    }
  } catch (err) {
    console.warn("[Plugin] Override retrieval failed:", err);
  }

  // 1. Fetch videodb provider files
  if (activeProvider === "videodb") {
    const apiKey = await PotokSDK.storage.local.getItem("videodb_key") || "";
    const url = `https://videodb.cloud/embed/splayer.php?type=serial&id=${mediaId}${apiKey ? `&key=${apiKey}` : ""}`;
    
    const response = await PotokSDK.http.get(`/api/proxy?url=${encodeURIComponent(url)}`, {
      "Referer": "https://videodb.cloud/"
    });
    if (response.status === 200) {
      const html = response.data;
      const fileIndex = html.search(/"file"\s*:/i);
      if (fileIndex !== -1) {
        const textFromFile = html.substring(fileIndex);
        const bracketStart = textFromFile.indexOf("[");
        if (bracketStart !== -1) {
          let balance = 0, jsonStr = "";
          for (let i = bracketStart; i < textFromFile.length; i++) {
            const char = textFromFile[i];
            if (char === "[") balance++;
            else if (char === "]") balance--;
            jsonStr += char;
            if (balance === 0) break;
          }
          const cleanJSON = jsonStr.replace(/,\s*([}\]])/g, "$1");
          const balSeasons = JSON.parse(cleanJSON);

          const extractNum = (str) => {
            const m = str.match(/([0-9]+)/);
            return m ? parseInt(m[1], 10) : 1;
          };

          let fileIndexSeq = 0;
          balSeasons.forEach((seasonObj) => {
            const sNum = extractNum(seasonObj.title);
            if (seasonObj.folder) {
              seasonObj.folder.forEach((epObj) => {
                const epNum = extractNum(epObj.title);
                
                // Parse playlist for voices
                const parsedData = parsePlayerJSFile(epObj.file);
                const audios = parsedData ? Object.keys(parsedData).map(voice => ({
                  id: voice,
                  name: voice,
                  url: parsedData[voice][0]?.url || ""
                })) : [];

                parsedFiles.push({
                  id: `videodb:${sNum}:${epNum}`,
                  title: epObj.title,
                  season: sNum,
                  episode: epNum,
                  index: fileIndexSeq++,
                  url: epObj.file,
                  provider: "videodb",
                  audios,
                  isWatched: checkWatched(sNum, epNum),
                  headers: { "Referer": "https://videodb.cloud/" }
                });
              });
            }
          });
        }
      }
    }
  } 
  // 2. Fetch lift provider files
  else if (activeProvider === "lift") {
    // Resolve external ids from BFF
    const idsRes = await PotokSDK.http.get(`/api/media/detail/tv/${mediaId}/external_ids`);
    if (idsRes.status === 200) {
      const ids = typeof idsRes.data === 'string' ? JSON.parse(idsRes.data) : idsRes.data;
      let kpId = ids?.kpId;
      let imdbId = ids?.imdbId;

      if (!kpId) {
        try {
          const token = "04941a9a3ca3ac16e2b4327347bbc1";
          const directUrl = `https://api.alloha.tv/?token=${token}&tmdb=${mediaId}`;
          const directRes = await PotokSDK.http.get(directUrl).catch(() => null);
          if (directRes && directRes.status === 200 && directRes.data) {
            const json = typeof directRes.data === 'string' ? JSON.parse(directRes.data) : directRes.data;
            if (json && json.data) {
              if (json.data.id_kp) kpId = String(json.data.id_kp);
              if (json.data.imdb) imdbId = String(json.data.imdb);
            }
          }
        } catch {}
      }

      if (kpId || imdbId) {
        let embedUrl = "";
        if (kpId) {
          embedUrl = `https://api.zenithjs.ws/embed/kp/${kpId}?host=lift.com`;
        } else {
          embedUrl = `https://api.zenithjs.ws/embed/imdb/${imdbId}?host=lift.com`;
        }

        const response = await PotokSDK.http.get(`/api/proxy?url=${encodeURIComponent(embedUrl)}`, {
          "Referer": "https://lift3.ws"
        });
        if (response.status === 200) {
          const html = response.data;
          const seasonsIndex = html.search(/seasons\s*:/i);
          if (seasonsIndex !== -1) {
            const textFromSeasons = html.substring(seasonsIndex);
            const bracketStart = textFromSeasons.indexOf("[");
            if (bracketStart !== -1) {
              let balance = 0, jsonStr = "";
              for (let i = bracketStart; i < textFromSeasons.length; i++) {
                const char = textFromSeasons[i];
                if (char === "[") balance++;
                else if (char === "]") balance--;
                jsonStr += char;
                if (balance === 0) break;
              }
              const balSeasons = JSON.parse(jsonStr.replace(/,\s*([}\]])/g, "$1"));
              let fileIndexSeq = 0;
              balSeasons.forEach((seasonObj) => {
                const sNum = seasonObj.season;
                if (seasonObj.episodes) {
                  seasonObj.episodes.forEach((epObj) => {
                    const epMatch = epObj.episode.match(/([0-9]+)/);
                    const epNum = epMatch ? parseInt(epMatch[1], 10) : 1;
                    const streamUrl = epObj.hls || epObj.dasha || epObj.dash || "";
                    const audioNames = epObj.audio?.names || [];
                    const audios = audioNames.map((name, idx) => ({
                      id: String(idx),
                      name,
                      url: streamUrl + (streamUrl.includes("?") ? "&" : "?") + `audio=${idx}`
                    }));

                    parsedFiles.push({
                      id: `lift:${sNum}:${epNum}`,
                      title: epObj.episode,
                      season: sNum,
                      episode: epNum,
                      index: fileIndexSeq++,
                      url: streamUrl,
                      provider: "lift",
                      audios,
                      isWatched: checkWatched(sNum, epNum),
                      headers: {
                        "Origin": "https://api.zenithjs.ws",
                        "Referer": "https://api.zenithjs.ws/"
                      }
                    });
                  });
                }
              });
            }
          }
        }
      }
    }
  } 
  // 3. Fetch kinotochka provider files
  else if (activeProvider === "kinotochka") {
    const idsRes = await PotokSDK.http.get(`/api/media/detail/tv/${mediaId}/external_ids`);
    if (idsRes.status === 200) {
      const ids = typeof idsRes.data === 'string' ? JSON.parse(idsRes.data) : idsRes.data;
      let kpId = ids?.kpId;
      if (!kpId) {
        const token = "04941a9a3ca3ac16e2b4327347bbc1";
        const directUrl = `https://api.alloha.tv/?token=${token}&tmdb=${mediaId}`;
        const directRes = await PotokSDK.http.get(directUrl).catch(() => null);
        if (directRes && directRes.status === 200 && directRes.data) {
          const directJson = typeof directRes.data === 'string' ? JSON.parse(directRes.data) : directRes.data;
          if (directJson?.data?.id_kp) {
            kpId = directJson.data.id_kp;
          }
        }
      }

      if (kpId) {
        const searchUrl = `https://kinovibe.vip/index.php?do=search&subaction=search&story=${kpId}`;
        const searchRes = await PotokSDK.http.get(`/api/proxy?url=${encodeURIComponent(searchUrl)}`);
        if (searchRes.status === 200) {
          const searchHtml = searchRes.data;
          const matches = [];
          let regexMatch;
          const regex = /href=["']([^"']+\.html)["']/gi;
          while ((regexMatch = regex.exec(searchHtml)) !== null) {
            const url = regexMatch[1];
            if (!url.includes('/tags/') && !url.includes('/xfsearch/') && !url.includes('/user/') && !url.includes('/catalog/') && !url.includes('/lastnews/')) {
              const fullUrl = url.startsWith('http') ? url : `https://kinovibe.vip${url.startsWith('/') ? '' : '/'}${url}`;
              if (!matches.includes(fullUrl)) {
                matches.push(fullUrl);
              }
            }
          }

          if (matches.length > 0) {
            const targetPageUrl = matches[0];
            const pageRes = await PotokSDK.http.get(`/api/proxy?url=${encodeURIComponent(targetPageUrl)}`);
            if (pageRes.status === 200) {
              const pageHtml = pageRes.data;
              const iframeSrcMatch = pageHtml.match(/iframe[^>]*src=["']([^"']*(?:alloha|allohacdn|player|iframe)[^"']*)["']/i);
              let playerUrl = iframeSrcMatch ? iframeSrcMatch[1] : null;
              if (!playerUrl) {
                const generalIframeMatch = pageHtml.match(/iframe[^>]*src=["']([^"']+)["']/i);
                if (generalIframeMatch) {
                  playerUrl = generalIframeMatch[1];
                }
              }

              if (playerUrl) {
                if (playerUrl.startsWith("//")) {
                  playerUrl = "https:" + playerUrl;
                }
                
                let playerHtml = "";
                const iframeRes = await PotokSDK.http.get(`/api/proxy?url=${encodeURIComponent(playerUrl)}`);
                if (iframeRes.status === 200) {
                  playerHtml = iframeRes.data;
                } else {
                  try {
                    const urlObj = new URL(playerUrl);
                    const rewrittenUrl = `https://api.alloha.tv${urlObj.pathname}${urlObj.search}`;
                    const rewrittenRes = await PotokSDK.http.get(`/api/proxy?url=${encodeURIComponent(rewrittenUrl)}`);
                    if (rewrittenRes.status === 200) {
                       playerHtml = rewrittenRes.data;
                    }
                  } catch {}
                }

                if (playerHtml) {
                  const fileIndex = playerHtml.search(/"file"\s*:/i);
                  if (fileIndex !== -1) {
                    const textFromFile = playerHtml.substring(fileIndex);
                    const bracketStart = textFromFile.indexOf("[");
                    if (bracketStart !== -1) {
                      let balance = 0, jsonStr = "";
                      for (let i = bracketStart; i < textFromFile.length; i++) {
                        const char = textFromFile[i];
                        if (char === "[") balance++;
                        else if (char === "]") balance--;
                        jsonStr += char;
                        if (balance === 0) break;
                      }
                      const cleanJSON = jsonStr.replace(/,\s*([}\]])/g, "$1");
                      const balSeasons = JSON.parse(cleanJSON);

                      const extractNum = (str) => {
                        const m = str.match(/([0-9]+)/);
                        return m ? parseInt(m[1], 10) : 1;
                      };

                      let fileIndexSeq = 0;
                      balSeasons.forEach((seasonObj) => {
                        const sNum = extractNum(seasonObj.title);
                        if (seasonObj.folder) {
                          seasonObj.folder.forEach((epObj) => {
                            const epNum = extractNum(epObj.title);
                            const parsedData = parsePlayerJSFile(epObj.file);
                            const audios = parsedData ? Object.keys(parsedData).map(voice => ({
                              id: voice,
                              name: voice,
                              url: parsedData[voice][0]?.url || ""
                            })) : [];

                            parsedFiles.push({
                              id: `kinotochka:${sNum}:${epNum}`,
                              title: epObj.title,
                              season: sNum,
                              episode: epNum,
                              index: fileIndexSeq++,
                              url: epObj.file,
                              provider: "kinotochka",
                              audios,
                              isWatched: checkWatched(sNum, epNum),
                              headers: { "Referer": "https://api.alloha.tv/" }
                            });
                          });
                        }
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
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

  // Apply automatic mapping offsets
  const autoMappedFiles = parsedFiles.map((file) => {
    const rawSeason = file.season;
    const targetSeason = rawSeason > maxValidSeason ? maxValidSeason : rawSeason;
    const offset = balancerSeasonOffsets[rawSeason] || 0;
    
    return {
      ...file,
      season: targetSeason,
      episode: file.episode + offset
    };
  });

  // 6. Refine seasons/episodes offsets if local database override exists
  const refinedFiles = autoMappedFiles.map((file) => {
    let finalSeason = file.season;
    let finalEpisode = file.episode;

    if (override && override.season !== undefined && override.season !== null) {
      finalSeason = override.season;
      const offset = override.episodeOffset ?? 0;
      finalEpisode = offset + 1 + file.index;
    }

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

  return refinedFiles;
}
