import { PotokSDK } from '../sdk.js';
import { parsePlayerJSFile, isRussian, normalizeQuality } from '../utils/parser.js';

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

  /**
   * Securely query local BFF API to map TMDB/IMDb IDs to Kinopoisk ID (id_kp)
   */
  async resolveKpId(tmdbId, imdbId, type) {
    try {
      const typePath = type === "tv" ? "tv" : "movie";
      const url = `/api/media/detail/${typePath}/${tmdbId}/external_ids`;
      console.log(`[Kinotochka] Resolving kpId via BFF: ${url}`);
      const response = await PotokSDK.http.get(url).catch(err => {
        console.error("[Kinotochka] BFF GET request failed:", err);
        return null;
      });
      
      if (response && response.status === 200 && response.data) {
        const json = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        if (json && json.kpId) {
          return String(json.kpId);
        }
      }
    } catch (err) {
      console.warn("[Kinotochka] Failed to resolve kpId via BFF:", err);
    }

    // Direct browser lookup fallback if BFF returned null
    try {
      const token = "04941a9a3ca3ac16e2b4327347bbc1";
      const directUrl = `https://api.alloha.tv/?token=${token}&tmdb=${tmdbId}`;
      console.log(`[Kinotochka] BFF returned no kpId. Attempting direct browser lookup: ${directUrl}`);
      const response = await PotokSDK.http.get(directUrl).catch(err => {
        console.error("[Kinotochka] Direct browser lookup GET request failed:", err);
        return null;
      });
      if (response && response.status === 200 && response.data) {
        const json = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        if (json && json.data && json.data.id_kp) {
          console.log(`[Kinotochka] Direct browser lookup succeeded: kpId = ${json.data.id_kp}`);
          return String(json.data.id_kp);
        }
      }
    } catch (err) {
      console.warn("[Kinotochka] Direct browser lookup failed:", err);
    }

    return null;
  }

  /**
   * Search external video sources for movies/series
   * @param {Object} query - Lookup queries
   * @param {string} query.type - "movie" or "tv"
   * @param {number} query.tmdbId - The TMDB identifier
   * @param {string} [query.kpId] - Kinopoisk ID if forwarded
   * @param {string} [query.imdbId] - IMDb ID if forwarded
   * @param {number} [query.season] - Season number
   * @param {number} [query.episode] - Episode number
   * @returns {Promise<Array<any>>}
   */
  async search(query) {
    try {
      console.log("[Kinotochka] Search started with query:", query);
      let kpId = query.kpId;
      if (!kpId) {
        kpId = await this.resolveKpId(query.tmdbId, query.imdbId, query.type);
      }

      if (!kpId) {
        console.warn("[Kinotochka] Failed to resolve Kinopoisk ID.");
        return [];
      }
      console.log(`[Kinotochka] Resolved Kinopoisk ID: ${kpId}. Querying kinovibe.vip...`);

      // 1. Query search on kinovibe.vip via CORS bypass proxy
      const searchUrl = `${this.host}/index.php?do=search&subaction=search&story=${kpId}`;
      console.log(`[Kinotochka] Fetching search results via proxy: ${searchUrl}`);
      const searchResponse = await PotokSDK.http.get(this.getProxyUrl(searchUrl)).catch(err => {
        console.error("[Kinotochka] Search GET proxy request failed:", err);
        return null;
      });

      if (!searchResponse || searchResponse.status !== 200) {
        console.warn("[Kinotochka] GET search request failed on kinovibe.vip via proxy");
        return [];
      }

      const searchHtml = searchResponse.data;
      
      // Extract links to movie pages ending in .html
      const matches = [];
      let regexMatch;
      const regex = /href=["']([^"']+\.html)["']/gi;
      while ((regexMatch = regex.exec(searchHtml)) !== null) {
        const url = regexMatch[1];
        if (!url.includes('/tags/') && !url.includes('/xfsearch/') && !url.includes('/user/') && !url.includes('/catalog/') && !url.includes('/lastnews/')) {
          const fullUrl = url.startsWith('http') ? url : `${this.host}${url.startsWith('/') ? '' : '/'}${url}`;
          if (!matches.includes(fullUrl)) {
            matches.push(fullUrl);
          }
        }
      }

      if (matches.length === 0) {
        console.warn("[Kinotochka] No movie page links found in search results on kinovibe.vip");
        return [];
      }

      // We'll scrape the first matched page link
      const targetPageUrl = matches[0];
      console.log(`[Kinotochka] Scraping target page via proxy: ${targetPageUrl}`);
      
      const pageResponse = await PotokSDK.http.get(this.getProxyUrl(targetPageUrl)).catch(err => {
        console.error("[Kinotochka] Page scrape proxy request failed:", err);
        return null;
      });
      if (!pageResponse || pageResponse.status !== 200) {
        console.warn(`[Kinotochka] Failed to load target page HTML from ${targetPageUrl}`);
        return [];
      }

      const pageHtml = pageResponse.data;

      // Extract iframe src pointing to Alloha player
      // We look for api.alloha.tv, api.allohacdn.com, or simply alloha/player iframes
      const iframeSrcMatch = pageHtml.match(/iframe[^>]*src=["']([^"']*(?:alloha|allohacdn|player|iframe)[^"']*)["']/i);
      
      let playerUrl = iframeSrcMatch ? iframeSrcMatch[1] : null;

      if (!playerUrl) {
        // Fallback: look for any iframe on the page
        const generalIframeMatch = pageHtml.match(/iframe[^>]*src=["']([^"']+)["']/i);
        if (generalIframeMatch) {
          playerUrl = generalIframeMatch[1];
        }
      }

      if (!playerUrl) {
        console.warn("[Kinotochka] No player iframe found on the movie page.");
        return [];
      }

      // If URL is protocol-relative, prepend https:
      if (playerUrl.startsWith("//")) {
        playerUrl = "https:" + playerUrl;
      } else if (playerUrl.startsWith("/")) {
        playerUrl = this.host + playerUrl;
      }

      console.log(`[Kinotochka] Found player iframe URL: ${playerUrl}`);

      // We will try to fetch the player iframe HTML, bypassing any client-side blocking
      // by sequentially replacing the domain with our fallback domains
      let playerHtml = null;
      let usedDomain = "";

      // Try the original URL first via proxy
      try {
        console.log(`[Kinotochka] Attempting to fetch iframe via proxy: ${playerUrl}`);
        const response = await PotokSDK.http.get(this.getProxyUrl(playerUrl)).catch(err => {
          console.error("[Kinotochka] Player iframe proxy request failed:", err);
          return null;
        });
        if (response && response.status === 200) {
          playerHtml = response.data;
          usedDomain = new URL(playerUrl).origin;
        }
      } catch (e) {
        console.warn("[Kinotochka] Direct iframe fetch failed:", e);
      }

      // Rewrite iframe fallback attempt if direct fetch failed
      if (!playerHtml) {
        try {
          // Rewrite the URL domain to our apiDomain
          const urlObj = new URL(playerUrl);
          const rewrittenUrl = `${this.apiDomain}${urlObj.pathname}${urlObj.search}`;
          console.log(`[Kinotochka] Attempting to fetch rewritten iframe via proxy: ${rewrittenUrl}`);
          const response = await PotokSDK.http.get(this.getProxyUrl(rewrittenUrl)).catch(err => {
            console.error("[Kinotochka] Rewritten player iframe proxy request failed:", err);
            return null;
          });
          if (response && response.status === 200) {
            playerHtml = response.data;
            usedDomain = this.apiDomain;
          }
        } catch (err) {
          console.warn(`[Kinotochka] Failed to fetch rewritten iframe from domain ${this.apiDomain}:`, err);
        }
      }

      if (!playerHtml) {
        console.warn("[Kinotochka] Failed to fetch player iframe content from any domain.");
        return [];
      }

      console.log(`[Kinotochka] Player iframe content fetched successfully from domain: ${usedDomain}`);

      // 2. Extract playlist and parse
      let rawPlaylist = "";
      const isMovie = query.type === "movie";

      if (isMovie) {
        const fileMatch = playerHtml.match(/"file"\s*:\s*"([^"]+)"/);
        if (!fileMatch) {
          console.warn("[Kinotochka] Player JS 'file' string not found for movie.");
          return [];
        }
        rawPlaylist = fileMatch[1];
      } else {
        // TV Show: Extract folder structure JSON representing seasons and episodes
        const fileIndex = playerHtml.search(/"file"\s*:/i);
        if (fileIndex === -1) {
          console.warn("[Kinotochka] Player JS 'file' string not found for series.");
          return [];
        }

        const textFromFile = playerHtml.substring(fileIndex);
        const bracketStart = textFromFile.indexOf("[");
        if (bracketStart === -1) {
          console.warn("[Kinotochka] Series seasons bracket not found.");
          return [];
        }

        let balance = 0;
        let jsonStr = "";
        for (let i = bracketStart; i < textFromFile.length; i++) {
          const char = textFromFile[i];
          if (char === "[") balance++;
          else if (char === "]") balance--;

          jsonStr += char;
          if (balance === 0) {
            break;
          }
        }

        try {
          const cleanJSON = jsonStr.replace(/,\s*([}\]])/g, "$1"); // Strip trailing commas
          const seasons = JSON.parse(cleanJSON);
          if (!seasons || seasons.length === 0) {
            return [];
          }

          const extractNum = (str) => {
            const m = str.match(/([0-9]+)/);
            return m ? parseInt(m[1], 10) : 1;
          };

          const targetSeason = query.season || 1;
          const seasonFolder = seasons.find(s => extractNum(s.title) === targetSeason) || seasons[0];
          if (!seasonFolder || !seasonFolder.folder) {
            return [];
          }

          const targetEpisode = query.episode || 1;
          const episodeFile = seasonFolder.folder.find(ep => extractNum(ep.title) === targetEpisode) || seasonFolder.folder[0];
          if (!episodeFile || !episodeFile.file) {
            return [];
          }

          rawPlaylist = episodeFile.file;
        } catch (jsonErr) {
          console.error("[Kinotochka] JSON parsing of serial layout failed:", jsonErr);
          return [];
        }
      }

      const parsedData = parsePlayerJSFile(rawPlaylist);
      if (!parsedData) {
        console.warn("[Kinotochka] Failed to parse raw PlayerJS playlist string.");
        return [];
      }

      const streams = [];
      const voices = Object.keys(parsedData);

      // Prioritize Russian voice tracks
      voices.sort((a, b) => {
        const aRu = isRussian(a);
        const bRu = isRussian(b);
        if (aRu && !bRu) return -1;
        if (!aRu && bRu) return 1;
        return a.localeCompare(b);
      });

      for (const voice of voices) {
        const options = parsedData[voice];
        if (options.length === 0) continue;

        const audios = options.map(opt => ({
          name: voice,
          url: opt.url
        }));

        streams.push({
          provider: this.id,
          quality: normalizeQuality(options[0].quality),
          voice: voice,
          label: query.type === "tv" ? `S${query.season || 1}E${query.episode || 1}` : "Киноточка",
          url: options[0].url,
          kind: options[0].url.includes(".m3u8") ? "hls" : "mp4",
          headers: { "Referer": usedDomain + "/" },
          audios: audios
        });
      }

      return streams;
    } catch (err) {
      console.error("[Kinotochka] Search/scraping failed:", err);
      return [];
    }
  }
}
