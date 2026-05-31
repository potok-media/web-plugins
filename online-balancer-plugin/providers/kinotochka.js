import { PotokSDK } from 'potok-sdk';
import { parsePlayerJSFile, sortVoices, normalizeQuality, extractNum, extractBalancedBracket } from '../utils/parser.js';

export class KinotochkaProvider {
  constructor() {
    this.id = "kinotochka";
    this.name = "Киноточка";
    this.host = "https://kinovibe.vip";
    this.apiDomain = 'https://api.alloha.tv';
  }

  getProxyUrl(url) {
    return `/api/proxy?url=${encodeURIComponent(url)}`;
  }

  async resolveMediaDetails(tmdbId, type) {
    try {
      const typePath = type === "tv" ? "tv" : "movie";
      const url = `/api/media/detail/${typePath}/${tmdbId}`;
      const response = await PotokSDK.http.get(url).catch(() => null);
      
      if (response && response.status === 200 && response.data) {
        const json = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        if (json) {
          return {
            kpId: json.kpId ? String(json.kpId) : "",
            imdbId: json.imdbId ? String(json.imdbId) : "",
            title: json.title || ""
          };
        }
      }
    } catch (err) {
      console.warn("[Kinotochka] Failed to resolve media details via BFF:", err);
    }

    // Direct browser lookup fallback
    try {
      const token = "04941a9a3ca3ac16e2b4327347bbc1";
      const directUrl = `https://api.alloha.tv/?token=${token}&tmdb=${tmdbId}`;
      const response = await PotokSDK.http.get(directUrl).catch(() => null);
      if (response && response.status === 200 && response.data) {
        const json = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        if (json?.data) {
          return {
            kpId: json.data.id_kp ? String(json.data.id_kp) : "",
            imdbId: json.data.imdb ? String(json.data.imdb) : "",
            title: json.data.name || ""
          };
        }
      }
    } catch (err) {
      console.warn("[Kinotochka] Direct lookup failed:", err);
    }

    return null;
  }

  /**
   * Search external video sources for movies/series
   */
  async search(query) {
    try {
      const details = await this.resolveMediaDetails(query.tmdbId, query.type);
      if (!details) return [];

      let kpId = details.kpId;
      let title = details.title;
      let matches = [];

      // 1. Try find-by-kinopoisk.php API first (highly precise)
      if (kpId) {
        const apiUrl = `${this.host}/api/find-by-kinopoisk.php?kinopoisk=${kpId}`;
        const apiResponse = await PotokSDK.http.get(this.getProxyUrl(apiUrl)).catch(() => null);
        if (apiResponse && apiResponse.status === 200 && apiResponse.data) {
          try {
            const json = typeof apiResponse.data === 'string' ? JSON.parse(apiResponse.data) : apiResponse.data;
            if (Array.isArray(json)) {
              for (const item of json) {
                if (item.url) {
                  const fullUrl = item.url.startsWith('http') ? item.url : `${this.host}${item.url.startsWith('/') ? '' : '/'}${item.url}`;
                  if (/\/[0-9]+-[^\/]+\.html$/i.test(fullUrl) && !matches.includes(fullUrl)) {
                    matches.push(fullUrl);
                  }
                }
              }
            }
          } catch (e) {
            console.warn("[Kinotochka] Failed to parse find-by-kinopoisk response:", e);
          }
        }
      }

      // 2. Second attempt: search by kpId in DLE search
      if (matches.length === 0 && kpId) {
        const searchUrl = `${this.host}/index.php?do=search&subaction=search&story=${kpId}`;
        const searchResponse = await PotokSDK.http.get(this.getProxyUrl(searchUrl)).catch(() => null);
        if (searchResponse && searchResponse.status === 200) {
          let regexMatch;
          const regex = /href=["']([^"']+\.html)["']/gi;
          while ((regexMatch = regex.exec(searchResponse.data)) !== null) {
            const url = regexMatch[1];
            if (/\/[0-9]+-[^\/]+\.html$/i.test(url)) {
              const fullUrl = url.startsWith('http') ? url : `${this.host}${url.startsWith('/') ? '' : '/'}${url}`;
              if (!matches.includes(fullUrl)) matches.push(fullUrl);
            }
          }
        }
      }

      // 3. Third attempt: search by Russian title if kpId search failed or was empty
      if (matches.length === 0 && title) {
        console.log(`[Kinotochka] Searching by title fallback: ${title}`);
        const searchUrl = `${this.host}/index.php?do=search&subaction=search&story=${encodeURIComponent(title)}`;
        const searchResponse = await PotokSDK.http.get(this.getProxyUrl(searchUrl)).catch(() => null);
        if (searchResponse && searchResponse.status === 200) {
          let regexMatch;
          const regex = /href=["']([^"']+\.html)["']/gi;
          while ((regexMatch = regex.exec(searchResponse.data)) !== null) {
            const url = regexMatch[1];
            if (/\/[0-9]+-[^\/]+\.html$/i.test(url)) {
              const fullUrl = url.startsWith('http') ? url : `${this.host}${url.startsWith('/') ? '' : '/'}${url}`;
              if (!matches.includes(fullUrl)) matches.push(fullUrl);
            }
          }
        }
      }

      if (matches.length === 0) return [];

      // Scrape playlist or player iframe from target page
      const targetPageUrl = matches.find(url => {
        if (query.type === "tv" && query.season) {
          const sMatch = url.match(/-([0-9]+)-sezon/i);
          if (sMatch) {
            return parseInt(sMatch[1], 10) === query.season;
          }
        }
        return true;
      }) || matches[0];

      const pageResponse = await PotokSDK.http.get(this.getProxyUrl(targetPageUrl)).catch(() => null);
      if (!pageResponse || pageResponse.status !== 200) return [];

      const pageHtml = pageResponse.data;

      // A. Check if there's a direct .txt playlist file in the Playerjs configuration
      const playlistTxtMatch = pageHtml.match(/file\s*:\s*["'](https?:\/\/[^"']+\.txt)["']/i);
      if (playlistTxtMatch) {
        const playlistUrl = playlistTxtMatch[1];
        console.log(`[Kinotochka] Found direct .txt playlist URL: ${playlistUrl}`);
        const playlistResponse = await PotokSDK.http.get(this.getProxyUrl(playlistUrl)).catch(() => null);
        if (playlistResponse && playlistResponse.status === 200 && playlistResponse.data) {
          try {
            const playlistData = typeof playlistResponse.data === 'string' ? JSON.parse(playlistResponse.data) : playlistResponse.data;
            if (playlistData?.playlist) {
              const targetEpisode = query.episode || 1;
              
              const extractNum = (str) => {
                const m = str.match(/([0-9]+)/);
                return m ? parseInt(m[1], 10) : 1;
              };

              const episodeItem = playlistData.playlist.find((ep, idx) => {
                const epNum = extractNum(ep.comment) || (idx + 1);
                return epNum === targetEpisode;
              }) || playlistData.playlist[0];

              if (episodeItem && episodeItem.file) {
                const parsedData = parsePlayerJSFile(episodeItem.file);
                if (parsedData) {
                  const voices = sortVoices(Object.keys(parsedData));
                  if (voices.length > 0) {
                    const audios = [];
                    let maxQuality = "1080p";
                    let defaultUrl = "";
                    let defaultKind = "mp4";

                    const voiceMatch = episodeItem.comment.match(/\[([^\]]+)\]/);
                    const commentVoiceName = voiceMatch ? voiceMatch[1] : "default";

                    for (const voice of voices) {
                      const options = parsedData[voice];
                      for (const opt of options) {
                        const qName = opt.quality ? normalizeQuality(opt.quality) : "";
                        const voiceName = voice === "default" ? commentVoiceName : voice;
                        const trackName = qName ? `${voiceName} (${qName})` : voiceName;

                        if (!defaultUrl) {
                          defaultUrl = opt.url;
                          defaultKind = opt.url.includes(".m3u8") ? "hls" : "mp4";
                          maxQuality = qName || "1080p";
                        }
                        audios.push({ name: trackName, url: opt.url });
                      }
                    }

                    return [{
                      provider: this.id,
                      quality: maxQuality,
                      voice: voices.map(v => v === "default" ? commentVoiceName : v).join(", "),
                      label: query.type === "tv" ? `S${query.season || 1}E${query.episode || 1}` : this.name,
                      url: defaultUrl,
                      kind: defaultKind,
                      headers: { "Referer": new URL(targetPageUrl).origin + "/" },
                      audios
                    }];
                  }
                }
              }
            }
          } catch (jsonErr) {
            console.error("[Kinotochka] Failed to parse .txt playlist JSON:", jsonErr);
          }
        }
      }

      // B. Fallback to iframe parser if direct .txt playlist wasn't found or failed
      const iframeSrcMatch = pageHtml.match(/iframe[^>]*src=["']([^"']*(?:alloha|allohacdn|player|iframe)[^"']*)["']/i);
      let playerUrl = iframeSrcMatch ? iframeSrcMatch[1] : (pageHtml.match(/iframe[^>]*src=["']([^"']+)["']/i)?.[1] || null);
      if (!playerUrl) return [];

      if (playerUrl.startsWith("//")) playerUrl = "https:" + playerUrl;
      else if (playerUrl.startsWith("/")) playerUrl = this.host + playerUrl;

      // Try player domains sequentially with custom proxy and fallback
      let playerHtml = null;
      let usedDomain = "";
      for (const domain of [new URL(playerUrl).origin, this.apiDomain]) {
        try {
          const targetUrl = domain === this.apiDomain 
            ? `${this.apiDomain}${new URL(playerUrl).pathname}${new URL(playerUrl).search}`
            : playerUrl;
          
          const res = await PotokSDK.http.get(this.getProxyUrl(targetUrl)).catch(() => null);
          if (res && res.status === 200) {
            playerHtml = res.data;
            usedDomain = domain;
            break;
          }
        } catch {}
      }
      if (!playerHtml) return [];

      // Extract playlist and parse
      let rawPlaylist = "";
      const isMovie = query.type === "movie";

      if (isMovie) {
        const fileMatch = playerHtml.match(/"file"\s*:\s*"([^"]+)"/);
        if (!fileMatch) return [];
        rawPlaylist = fileMatch[1];
      } else {
        const fileIndex = playerHtml.search(/"file"\s*:/i);
        if (fileIndex === -1) return [];

        const jsonStr = extractBalancedBracket(playerHtml.substring(fileIndex), "[", "]");
        if (!jsonStr) return [];

        try {
          const cleanJSON = jsonStr.replace(/,\s*([}\]])/g, "$1");
          const seasons = JSON.parse(cleanJSON);
          if (!seasons || seasons.length === 0) return [];

          const targetSeason = query.season || 1;
          const seasonFolder = seasons.find(s => extractNum(s.title) === targetSeason) || seasons[0];
          if (!seasonFolder || !seasonFolder.folder) return [];

          const targetEpisode = query.episode || 1;
          const episodeFile = seasonFolder.folder.find(ep => extractNum(ep.title) === targetEpisode) || seasonFolder.folder[0];
          if (!episodeFile || !episodeFile.file) return [];

          rawPlaylist = episodeFile.file;
        } catch (jsonErr) {
          console.error("[Kinotochka] JSON parse failed:", jsonErr);
          return [];
        }
      }

      const parsedData = parsePlayerJSFile(rawPlaylist);
      if (!parsedData) return [];

      const voices = sortVoices(Object.keys(parsedData));
      if (voices.length === 0) return [];

      const audios = [];
      let maxQuality = "1080p";
      let defaultUrl = "";
      let defaultKind = "hls";

      for (const voice of voices) {
        const options = parsedData[voice];
        for (const opt of options) {
          const qName = opt.quality ? normalizeQuality(opt.quality) : "";
          const trackName = qName ? `${voice} (${qName})` : voice;

          if (!defaultUrl) {
            defaultUrl = opt.url;
            defaultKind = opt.url.includes(".m3u8") ? "hls" : "mp4";
            maxQuality = qName || "1080p";
          }
          audios.push({ name: trackName, url: opt.url });
        }
      }

      return [{
        provider: this.id,
        quality: maxQuality,
        voice: voices.join(", "),
        label: query.type === "tv" ? `S${query.season || 1}E${query.episode || 1}` : this.name,
        url: defaultUrl,
        kind: defaultKind,
        headers: { "Referer": usedDomain + "/" },
        audios
      }];
    } catch (err) {
      console.error("[Kinotochka] Scraping failed:", err);
      return [];
    }
  }
}
