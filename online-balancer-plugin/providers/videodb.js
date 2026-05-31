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
        const fileIndex = html.search(/"file"\s*:/i);
        if (fileIndex === -1) return [];

        const textFromFile = html.substring(fileIndex);
        const bracketStart = textFromFile.indexOf("[");
        if (bracketStart === -1) return [];

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
          if (!seasons || seasons.length === 0) return [];

          const extractNum = (str) => {
            const m = str.match(/([0-9]+)/);
            return m ? parseInt(m[1], 10) : 1;
          };

          // Find requested season
          const targetSeason = query.season || 1;
          const seasonFolder = seasons.find(s => extractNum(s.title) === targetSeason) || seasons[0];
          if (!seasonFolder || !seasonFolder.folder) return [];

          // Find requested episode
          const targetEpisode = query.episode || 1;
          const episodeFile = seasonFolder.folder.find(ep => extractNum(ep.title) === targetEpisode) || seasonFolder.folder[0];
          if (!episodeFile || !episodeFile.file) return [];

          rawPlaylist = episodeFile.file;
        } catch (jsonErr) {
          console.error("[VideoDB] JSON parsing of serial layout failed:", jsonErr);
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
        label: (query.type === "tv" && query.season !== undefined) ? `S${query.season}E${query.episode}` : this.name,
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
