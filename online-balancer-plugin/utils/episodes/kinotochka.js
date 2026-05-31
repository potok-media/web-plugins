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
      const searchUrl = `https://kinovibe.vip/index.php?do=search&subaction=search&story=${kpId}`;
      const searchRes = await PotokSDK.http.get(`/api/proxy?url=${encodeURIComponent(searchUrl)}`).catch(() => null);
      if (searchRes && searchRes.status === 200) {
        const searchHtml = searchRes.data;
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
          if (!url.includes('/tags/') && !url.includes('/xfsearch/') && !url.includes('/user/') && !url.includes('/catalog/') && !url.includes('/lastnews/')) {
            const fullUrl = url.startsWith('http') ? url : `https://kinovibe.vip${url.startsWith('/') ? '' : '/'}${url}`;
            if (!matches.includes(fullUrl)) {
              matches.push(fullUrl);
            }
          }
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
  return parsedFiles;
}
