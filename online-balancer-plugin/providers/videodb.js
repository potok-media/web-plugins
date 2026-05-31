import { PotokSDK } from '../sdk.js';
import { parsePlayerJSFile, isRussian, normalizeQuality } from '../utils/parser.js';

export class VideoDBProvider {
  constructor() {
    this.id = "videodb";
    this.name = "VideoDB Cloud";
    this.host = "https://videodb.cloud";
  }

  /**
   * Search external video sources for movies/series
   * @param {Object} query - Lookup queries
   * @param {string} query.type - "movie" or "tv"
   * @param {number} query.tmdbId - The TMDB identifier
   * @param {number} [query.season] - Season number
   * @param {number} [query.episode] - Episode number
   * @returns {Promise<Array<any>>}
   */
  async search(query) {
    try {
      const apiKey = await PotokSDK.storage.local.getItem("videodb_key");
      const isMovie = query.type === "movie";
      const baseUrl = isMovie 
        ? `${this.host}/embed/player.php?type=movie&id=${query.tmdbId}`
        : `${this.host}/embed/splayer.php?type=serial&id=${query.tmdbId}`;

      const finalUrl = baseUrl + (apiKey ? `&key=${apiKey}` : "");

      // Execute request directly through the parent window's browser fetch RPC
      const response = await PotokSDK.http.get(finalUrl, {
        "Referer": this.host + "/"
      });

      if (response.status !== 200) {
        return [];
      }

      const html = response.data;
      let rawPlaylist = "";

      if (isMovie) {
        // 1. Movie: Extract PlayerJS playlist encoded string from single file match
        const fileMatch = html.match(/"file"\s*:\s*"([^"]+)"/);
        if (!fileMatch) {
          return [];
        }
        rawPlaylist = fileMatch[1];
      } else {
        // TV Show/Anime: Use unified episodes logic to fetch mapped/normalized episode file
        const { fetchOnlineEpisodes } = await import('../utils/episodes.js');
        const refinedFiles = await fetchOnlineEpisodes(this.id, { id: query.tmdbId }).catch(() => []);
        const file = refinedFiles.find(f => f.season === query.season && f.episode === query.episode);
        if (!file || !file.url) {
          return [];
        }
        rawPlaylist = file.url;
      }

      const parsedData = parsePlayerJSFile(rawPlaylist);
      if (!parsedData) {
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

      if (voices.length > 0) {
        const audios = [];
        let maxQuality = "1080p";
        let defaultUrl = "";
        let defaultKind = "hls";

        for (const voice of voices) {
          const options = parsedData[voice];
          if (options.length === 0) continue;

          const opt = options[0];
          if (!defaultUrl) {
            defaultUrl = opt.url;
            defaultKind = opt.url.includes(".m3u8") ? "hls" : "mp4";
            maxQuality = normalizeQuality(opt.quality);
          }

          audios.push({
            name: voice,
            url: opt.url
          });
        }

        const voiceLabel = `Мультиаудио (${voices.join(", ")})`;

        streams.push({
          provider: this.id,
          quality: maxQuality,
          voice: voiceLabel,
          label: query.type === "tv" ? `S${query.season || 1}E${query.episode || 1}` : "VideoDB Cloud",
          url: defaultUrl,
          kind: defaultKind,
          headers: { "Referer": this.host + "/" },
          audios: audios
        });
      }

      return streams;
    } catch (err) {
      console.error("[VideoDB] Search failed:", err);
      return [];
    }
  }
}
