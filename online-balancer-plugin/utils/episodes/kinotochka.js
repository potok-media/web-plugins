import { parsePlayerJSFile } from '../parser.js';
import { PotokSDK } from 'potok-sdk';

export async function fetchKinotochkaEpisodes(mediaId, checkWatched) {
  const parsedFiles = [];
  const idsRes = await PotokSDK.http.get(`/api/media/detail/tv/${mediaId}`);
  if (idsRes.status === 200) {
    const details = typeof idsRes.data === 'string' ? JSON.parse(idsRes.data) : idsRes.data;
    let kpId = details?.kpId;
    let title = details?.title || "";

    if (!kpId) {
      const token = "04941a9a3ca3ac16e2b4327347bbc1";
      const directUrl = `https://api.alloha.tv/?token=${token}&tmdb=${mediaId}`;
      const directRes = await PotokSDK.http.get(directUrl).catch(() => null);
      if (directRes && directRes.status === 200 && directRes.data) {
        const directJson = typeof directRes.data === 'string' ? JSON.parse(directRes.data) : directRes.data;
        if (directJson?.data?.id_kp) {
          kpId = directJson.data.id_kp;
          title = title || directJson.data.name || "";
        }
      }
    }

    let matches = [];
    if (kpId) {
      const apiUrl = `https://kinovibe.vip/api/find-by-kinopoisk.php?kinopoisk=${kpId}`;
      const apiResponse = await PotokSDK.http.get(`/api/proxy?url=${encodeURIComponent(apiUrl)}`).catch(() => null);
      if (apiResponse && apiResponse.status === 200 && apiResponse.data) {
        try {
          const json = typeof apiResponse.data === 'string' ? JSON.parse(apiResponse.data) : apiResponse.data;
          if (Array.isArray(json)) {
            for (const item of json) {
              if (item.url) {
                const fullUrl = item.url.startsWith('http') ? item.url : `https://kinovibe.vip${item.url.startsWith('/') ? '' : '/'}${item.url}`;
                if (/\/[0-9]+-[^\/]+\.html$/i.test(fullUrl) && !matches.includes(fullUrl)) {
                  matches.push(fullUrl);
                }
              }
            }
          }
        } catch (e) {
          console.warn("[Kinotochka Episode] Failed to parse find-by-kinopoisk response:", e);
        }
      }
    }

    if (matches.length === 0 && kpId) {
      const searchUrl = `https://kinovibe.vip/index.php?do=search&subaction=search&story=${kpId}`;
      const searchRes = await PotokSDK.http.get(`/api/proxy?url=${encodeURIComponent(searchUrl)}`).catch(() => null);
      if (searchRes && searchRes.status === 200) {
        const searchHtml = searchRes.data;
        let regexMatch;
        const regex = /href=["']([^"']+\.html)["']/gi;
        while ((regexMatch = regex.exec(searchHtml)) !== null) {
          const url = regexMatch[1];
          if (/\/[0-9]+-[^\/]+\.html$/i.test(url)) {
            const fullUrl = url.startsWith('http') ? url : `https://kinovibe.vip${url.startsWith('/') ? '' : '/'}${url}`;
            if (!matches.includes(fullUrl)) {
              matches.push(fullUrl);
            }
          }
        }
      }
    }

    if (matches.length === 0 && title) {
      console.log(`[Kinotochka Episode] Searching by title fallback: ${title}`);
      const searchUrl = `https://kinovibe.vip/index.php?do=search&subaction=search&story=${encodeURIComponent(title)}`;
      const searchRes = await PotokSDK.http.get(`/api/proxy?url=${encodeURIComponent(searchUrl)}`).catch(() => null);
      if (searchRes && searchRes.status === 200) {
        const searchHtml = searchRes.data;
        let regexMatch;
        const regex = /href=["']([^"']+\.html)["']/gi;
        while ((regexMatch = regex.exec(searchHtml)) !== null) {
          const url = regexMatch[1];
          if (/\/[0-9]+-[^\/]+\.html$/i.test(url)) {
            const fullUrl = url.startsWith('http') ? url : `https://kinovibe.vip${url.startsWith('/') ? '' : '/'}${url}`;
            if (!matches.includes(fullUrl)) {
              matches.push(fullUrl);
            }
          }
        }
      }
    }

    if (matches.length > 0) {
      let fileIndexSeq = 0;
      const seenEpisodeIds = new Set();

      for (const targetPageUrl of matches.slice(0, 5)) {
        const pageRes = await PotokSDK.http.get(`/api/proxy?url=${encodeURIComponent(targetPageUrl)}`);
        if (pageRes.status === 200) {
          const pageHtml = pageRes.data;

          // A. Try to parse direct .txt playlist first
          const playlistTxtMatch = pageHtml.match(/file\s*:\s*["'](https?:\/\/[^"']+\.txt)["']/i);
          if (playlistTxtMatch) {
            const playlistUrl = playlistTxtMatch[1];
            const playlistResponse = await PotokSDK.http.get(`/api/proxy?url=${encodeURIComponent(playlistUrl)}`).catch(() => null);
            if (playlistResponse && playlistResponse.status === 200 && playlistResponse.data) {
              try {
                const playlistData = typeof playlistResponse.data === 'string' ? JSON.parse(playlistResponse.data) : playlistResponse.data;
                if (playlistData?.playlist) {
                  const sMatch = targetPageUrl.match(/-([0-9]+)-sezon/i);
                  const sNum = sMatch ? parseInt(sMatch[1], 10) : 1;

                  const extractNum = (str) => {
                    const m = str.match(/([0-9]+)/);
                    return m ? parseInt(m[1], 10) : 1;
                  };

                  playlistData.playlist.forEach((epItem, idx) => {
                    const epNum = extractNum(epItem.comment) || (idx + 1);
                    const epId = `kinotochka:${sNum}:${epNum}`;
                    if (seenEpisodeIds.has(epId)) return;
                    seenEpisodeIds.add(epId);

                    const parsedData = parsePlayerJSFile(epItem.file);
                    const voiceMatch = epItem.comment.match(/\[([^\]]+)\]/);
                    const commentVoiceName = voiceMatch ? voiceMatch[1] : "default";

                    const audios = parsedData ? Object.keys(parsedData).map(voice => ({
                      id: voice === "default" ? commentVoiceName : voice,
                      name: voice === "default" ? commentVoiceName : voice,
                      url: parsedData[voice][0]?.url || ""
                    })) : [];

                    parsedFiles.push({
                      id: epId,
                      title: epItem.comment.replace(/<br>[^>]*$/, ""),
                      season: sNum,
                      episode: epNum,
                      index: fileIndexSeq++,
                      url: epItem.file,
                      provider: "kinotochka",
                      audios,
                      isWatched: checkWatched(sNum, epNum),
                      headers: { "Referer": new URL(targetPageUrl).origin + "/" }
                    });
                  });
                  continue; // Successfully processed this page via direct playlist, skip iframe checks
                }
              } catch (jsonErr) {
                console.error("[Kinotochka Episode] Failed to parse .txt playlist JSON:", jsonErr);
              }
            }
          }

          // B. Fallback to iframe
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
            let usedDomain = "https://api.alloha.tv";
            const iframeRes = await PotokSDK.http.get(`/api/proxy?url=${encodeURIComponent(playerUrl)}`);
            if (iframeRes.status === 200) {
              playerHtml = iframeRes.data;
              try { usedDomain = new URL(playerUrl).origin; } catch {}
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
                  try {
                    const balSeasons = JSON.parse(cleanJSON);

                    const extractNum = (str) => {
                      const m = str.match(/([0-9]+)/);
                      return m ? parseInt(m[1], 10) : 1;
                    };

                    balSeasons.forEach((seasonObj) => {
                      const sNum = extractNum(seasonObj.title);
                      if (seasonObj.folder) {
                        seasonObj.folder.forEach((epObj) => {
                          const epNum = extractNum(epObj.title);
                          const epId = `kinotochka:${sNum}:${epNum}`;
                          if (seenEpisodeIds.has(epId)) return;
                          seenEpisodeIds.add(epId);

                          const parsedData = parsePlayerJSFile(epObj.file);
                          const audios = parsedData ? Object.keys(parsedData).map(voice => ({
                            id: voice,
                            name: voice,
                            url: parsedData[voice][0]?.url || ""
                          })) : [];

                          parsedFiles.push({
                            id: epId,
                            title: epObj.title,
                            season: sNum,
                            episode: epNum,
                            index: fileIndexSeq++,
                            url: epObj.file,
                            provider: "kinotochka",
                            audios,
                            isWatched: checkWatched(sNum, epNum),
                            headers: { "Referer": usedDomain + "/" }
                          });
                        });
                      }
                    });
                  } catch (e) {
                    console.error("[Kinotochka Episode] Failed to parse balancer JSON:", e);
                  }
                }
              }
            }
          }
        }
      }
  }
  return parsedFiles;
}
