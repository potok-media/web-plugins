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

  async resolveExternalIds(tmdbId, mediaType = "tv") {
    let kpId = "";
    let imdbId = "";

    // Query local BFF API for resolved external IDs (includes both kpId and imdbId)
    try {
      const typePath = mediaType === "tv" ? "tv" : "movie";
      const res = await PotokSDK.http.get(`/api/media/detail/${typePath}/${tmdbId}/external_ids`).catch(err => {
        console.error("[Lift] BFF GET request failed:", err);
        return null;
      });
      if (res && res.status === 200) {
        const responseObj = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        if (responseObj) {
          kpId = responseObj.kpId ? String(responseObj.kpId) : "";
          imdbId = responseObj.imdbId ? String(responseObj.imdbId) : "";
        }
      }
    } catch (err) {
      console.error("[Lift] External IDs resolution via BFF failed:", err);
    }

    // Direct browser lookup fallback if kpId is missing
    if (!kpId) {
      try {
        const token = "04941a9a3ca3ac16e2b4327347bbc1";
        const directUrl = `https://api.alloha.tv/?token=${token}&tmdb=${tmdbId}`;
        console.log(`[Lift] BFF returned no kpId. Attempting direct browser lookup: ${directUrl}`);
        const response = await PotokSDK.http.get(directUrl).catch(err => {
          console.error("[Lift] Direct browser lookup GET request failed:", err);
          return null;
        });
        if (response && response.status === 200 && response.data) {
          const json = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
          if (json && json.data) {
            if (json.data.id_kp) kpId = String(json.data.id_kp);
            if (json.data.imdb) imdbId = String(json.data.imdb);
          }
        }
      } catch (err) {
        console.warn("[Lift] Direct browser lookup failed:", err);
      }
    }

    return { kpId, imdbId };
  }

  async search(query) {
    try {
      const { kpId, imdbId } = await this.resolveExternalIds(query.tmdbId, query.type);
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
      const seasonsIndex = html.search(/seasons\s*:/i);
      if (seasonsIndex !== -1) {
        // TV Show/Anime: Use unified episodes logic to fetch mapped/normalized episode file
        const { fetchOnlineEpisodes } = await import('../utils/episodes.js');
        const refinedFiles = await fetchOnlineEpisodes(this.id, { id: query.tmdbId }).catch(() => []);
        const file = refinedFiles.find(f => f.season === query.season && f.episode === query.episode);
        if (!file || !file.url) {
          return [];
        }

        const streamUrl = this.normalizeUrl(file.url);
        const streams = [];

        if (file.audios && file.audios.length > 0) {
          streams.push({
            provider: this.id,
            quality: "1080p",
            voice: file.audios.map(a => a.name).join(", "),
            label: `S${query.season}E${query.episode}`,
            url: streamUrl,
            kind: streamUrl.includes(".mpd") ? "dash" : "hls",
            headers: streamHeaders,
            audios: file.audios
          });
        } else {
          streams.push({
            provider: this.id,
            quality: "1080p",
            voice: "Original (Zenith)",
            label: `S${query.season}E${query.episode}`,
            url: streamUrl,
            kind: streamUrl.includes(".mpd") ? "dash" : "hls",
            headers: streamHeaders,
            audios: []
          });
        }

        return streams;
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

      const streams = [];

      if (audioNames && audioNames.length > 0) {
        const audios = audioNames.map((name, idx) => ({
          name: name,
          url: streamUrl + (streamUrl.includes("?") ? "&" : "?") + `audio=${idx}`
        }));

        streams.push({
          provider: this.id,
          quality: "1080p",
          voice: audioNames.join(", "),
          label: "Lift",
          url: streamUrl,
          kind: streamUrl.includes(".mpd") ? "dash" : "hls",
          headers: streamHeaders,
          audios: audios
        });
      } else {
        streams.push({
          provider: this.id,
          quality: "1080p",
          voice: "Original (Zenith)",
          label: "Lift",
          url: streamUrl,
          kind: streamUrl.includes(".mpd") ? "dash" : "hls",
          headers: streamHeaders,
          audios: []
        });
      }

      return streams;
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
