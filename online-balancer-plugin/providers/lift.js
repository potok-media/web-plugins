import { PotokSDK } from '../sdk.js';

export class LiftProvider {
  constructor() {
    this.id = "lift";
    this.name = "Lift";
    this.embedHost = "https://api.zenithjs.ws";
    this.consumerHost = "lift.com";
    this.embedReferer = "https://lift3.ws";
    this.userAgent = "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36";
  }

  async resolveExternalIds(tmdbId) {
    try {
      const res = await PotokSDK.http.get(`https://api.alloha.tv/?token=04941a9a3ca3ac16e2b4327347bbc1&tmdb=${tmdbId}`);
      if (res.status === 200) {
        const data = JSON.parse(res.data);
        if (data) {
          return {
            kpId: data.id_kp ? String(data.id_kp) : "",
            imdbId: data.id_imdb ? String(data.id_imdb) : ""
          };
        }
      }
    } catch (err) {
      console.error("[Lift] ID resolution failed:", err);
    }
    return { kpId: "", imdbId: "" };
  }

  async search(query) {
    try {
      const { kpId, imdbId } = await this.resolveExternalIds(query.tmdbId);
      if (!kpId && !imdbId) {
        return [];
      }

      // Build zenithjs embed URL
      let embedUrl = "";
      if (kpId) {
        embedUrl = `${this.embedHost}/embed/kp/${kpId}?host=${this.consumerHost}`;
      } else {
        embedUrl = `${this.embedHost}/embed/imdb/${imdbId}?host=${this.consumerHost}`;
      }

      const headers = {
        "User-Agent": this.userAgent,
        "Referer": this.embedReferer,
        "Origin": this.embedReferer.replace(/\/$/, "")
      };

      const response = await PotokSDK.http.get(embedUrl, headers);
      if (response.status !== 200) return [];

      const html = response.data;
      
      // Stream headers mimic lift app stream headers
      const streamHeaders = {
        "User-Agent": this.userAgent,
        "Origin": this.embedHost,
        "Referer": this.embedHost + "/"
      };

      // Detect serial case: seasons:[...]
      const seasonsMatch = html.match(/seasons\s*:\s*(\[[\s\S]*?\])\s*,\s*/i) ||
                           html.match(/seasons\s*:\s*(\[[^\n\r]+)/i);

      if (seasonsMatch) {
        let seasons = [];
        try {
          seasons = JSON.parse(seasonsMatch[1].replace(/,\s*([}\]])/g, "$1")); // strip trailing commas
        } catch {
          return [];
        }

        const targetSeason = query.season || 1;
        const seasonData = seasons.find(s => s.season === targetSeason) || seasons[0];
        if (!seasonData || !seasonData.episodes) return [];

        const targetEpisode = query.episode || 1;
        const episodeData = seasonData.episodes.find(ep => {
          const match = ep.episode.match(/([0-9]+)/);
          return match && parseInt(match[1], 10) === targetEpisode;
        }) || seasonData.episodes[0];

        if (!episodeData) return [];

        const streamUrl = this.normalizeUrl(episodeData.hls || episodeData.dasha || episodeData.dash);
        if (!streamUrl) return [];

        const voice = episodeData.audio && episodeData.audio.names && episodeData.audio.names.length > 0
          ? episodeData.audio.names[0]
          : "Original (Zenith)";

        const audioNames = episodeData.audio ? episodeData.audio.names : [];

        return [{
          provider: this.id,
          quality: "1080p", // Lift supports adaptive HLS by default
          voice: voice,
          label: `S${targetSeason}E${targetEpisode}`,
          url: streamUrl,
          kind: streamUrl.includes(".mpd") ? "dash" : "hls",
          headers: streamHeaders,
          audioNames: audioNames
        }];
      }

      // Movie case: makePlayer({
      const makePlayerIndex = html.indexOf("makePlayer({");
      if (makePlayerIndex === -1) return [];

      const playerContent = html.substring(makePlayerIndex);
      
      const hlsMatch = playerContent.match(/hls\s*:\s*"([^"]+)"/i);
      const dashMatch = playerContent.match(/dash\s*:\s*"([^"]+)"/i) || playerContent.match(/dasha\s*:\s*"([^"]+)"/i);
      
      const rawUrl = hlsMatch ? hlsMatch[1] : (dashMatch ? dashMatch[1] : "");
      const streamUrl = this.normalizeUrl(rawUrl);
      if (!streamUrl) return [];

      // Extract audios
      const audioMatch = playerContent.match(/audio\s*:\s*\{"names":\[\s*([^\]]+)\]/i);
      let audioNames = [];
      if (audioMatch) {
        try {
          audioNames = JSON.parse(`[${audioMatch[1]}]`);
        } catch {}
      }

      const voice = audioNames.length > 0 ? audioNames[0] : "Original (Zenith)";

      return [{
        provider: this.id,
        quality: "1080p",
        voice: voice,
        label: "Lift",
        url: streamUrl,
        kind: streamUrl.includes(".mpd") ? "dash" : "hls",
        headers: streamHeaders,
        audioNames: audioNames
      }];
    } catch (err) {
      console.error("[Lift] Search failed:", err);
      return [];
    }
  }

  normalizeUrl(link) {
    if (!link) return "";
    return link.trim().replace(/\\u0026/g, "&").replace(/\\u003d/g, "=").replace(/\\\//g, "/");
  }
}
