import { PotokSDK } from 'potok-sdk';

export async function fetchLiftEpisodes(mediaId, checkWatched) {
  const parsedFiles = [];
  // Resolve external ids from BFF
  const idsRes = await PotokSDK.http.get(`/api/media/detail/tv/${mediaId}`);
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
  return parsedFiles;
}
