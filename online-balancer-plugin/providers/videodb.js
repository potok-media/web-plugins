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
   * @returns {Promise<Array<any>>}
   */
  async search(query) {
    try {
      const apiKey = await PotokSDK.storage.local.getItem("videodb_key");
      const baseUrl = query.type === "movie" 
        ? `${this.host}/embed/player.php?type=movie&id=${query.tmdbId}`
        : `${this.host}/embed/splayer.php?type=serial&id=${query.tmdbId}`;

      const finalUrl = baseUrl + (apiKey ? `&key=${apiKey}` : "");

      // Execute secure request through the parent window's proxy bypass RPC
      const response = await PotokSDK.http.get(finalUrl, {
        "Referer": this.host + "/"
      });

      if (response.status !== 200) {
        return [];
      }

      const html = response.data;
      
      // Extract PlayerJS encoded playlist from scripts inside HTML
      const fileMatch = html.match(/"file"\s*:\s*"([^"]+)"/);
      if (!fileMatch) {
        return [];
      }

      const rawFile = fileMatch[1];
      const parsedData = parsePlayerJSFile(rawFile);
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

      for (const voice of voices) {
        const options = parsedData[voice];
        if (options.length === 0) continue;

        // Build audios tracks collection
        const audios = options.map(opt => ({
          name: voice,
          url: opt.url
        }));

        // Normalize format into standard Potok contract
        streams.push({
          provider: this.id,
          quality: normalizeQuality(options[0].quality),
          voice: voice,
          label: query.type === "tv" ? `S${query.season}E${query.episode}` : "VideoDB Cloud",
          url: options[0].url,
          kind: options[0].url.includes(".m3u8") ? "hls" : "mp4",
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
