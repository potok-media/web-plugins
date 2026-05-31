import { PotokSDK } from 'potok-sdk';
import { parsePlayerJSFile, sortVoices, normalizeQuality } from '../utils/parser.js';

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
      const isMovie = query.type === "movie";
      const baseUrl = isMovie 
        ? `${this.host}/embed/player.php?type=movie&id=${query.tmdbId}`
        : `${this.host}/embed/splayer.php?type=serial&id=${query.tmdbId}`;

      const finalUrl = baseUrl + (apiKey ? `&key=${apiKey}` : "");

      const response = await PotokSDK.http.get(finalUrl, {
        "Referer": `${this.host}/`
      });

      if (response.status !== 200) {
        return [];
      }

      const html = response.data;
      let rawPlaylist = "";

      if (isMovie) {
        const fileMatch = html.match(/"file"\s*:\s*"([^"]+)"/);
        if (!fileMatch) return [];
        rawPlaylist = fileMatch[1];
      } else {
        const { fetchOnlineEpisodes } = await import('../utils/episodes.js');
        const refinedFiles = await fetchOnlineEpisodes(this.id, { id: query.tmdbId }).catch(() => []);
        const file = refinedFiles.find(f => f.season === query.season && f.episode === query.episode);
        if (!file || !file.url) return [];
        rawPlaylist = file.url;
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
        if (options.length === 0) continue;

        const opt = options[0];
        if (!defaultUrl) {
          defaultUrl = opt.url;
          defaultKind = opt.url.includes(".m3u8") ? "hls" : "mp4";
          maxQuality = normalizeQuality(opt.quality);
        }

        audios.push({ name: voice, url: opt.url });
      }

      return [{
        provider: this.id,
        quality: maxQuality,
        voice: voices.join(", "),
        label: query.type === "tv" ? `S${query.season || 1}E${query.episode || 1}` : this.name,
        url: defaultUrl,
        kind: defaultKind,
        headers: { "Referer": `${this.host}/` },
        audios
      }];
    } catch (err) {
      console.error("[VideoDB] Search failed:", err);
      return [];
    }
  }
}
