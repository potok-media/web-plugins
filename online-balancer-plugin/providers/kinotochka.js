import { PotokSDK } from '../sdk.js';

export class KinotochkaProvider {
  constructor() {
    this.id = "kinotochka";
    this.name = "Kinotochka";
    this.host = "https://kinovibe.vip";
    this.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  }

  async resolveKpId(tmdbId) {
    try {
      const res = await PotokSDK.http.get(`https://api.alloha.tv/?token=04941a9a3ca3ac16e2b4327347bbc1&tmdb=${tmdbId}`);
      if (res.status === 200) {
        const data = JSON.parse(res.data);
        if (data && data.id_kp) {
          return String(data.id_kp);
        }
      }
    } catch (err) {
      console.error("[Kinotochka] KP ID resolution failed:", err);
    }
    return null;
  }

  async search(query) {
    try {
      const kpId = await this.resolveKpId(query.tmdbId);
      if (!kpId) {
        return [];
      }

      const isMovie = query.type === "movie";
      const headers = {
        "User-Agent": this.userAgent,
        "Referer": this.host + "/"
      };

      if (isMovie) {
        // Film lookup
        const embedUrl = `${this.host}/embed/kinopoisk/${kpId}`;
        const response = await PotokSDK.http.get(embedUrl, headers);
        if (response.status !== 200) return [];

        const html = response.data;
        
        // Match playerjshd file config using Go regex ports
        const fileMatch = html.match(/id\s*:\s*['"]playerjshd['"].{0,800}?file\s*:\s*['"]([^'"]+)['"]/i) || 
                          html.match(/file\s*:\s*['"]([^'"]+)['"].{0,800}?id\s*:\s*['"]playerjshd['"]/i) ||
                          html.match(/\bfile\s*:\s*['"]([^'"]+)['"]/i);
        if (!fileMatch) return [];

        let rawFile = fileMatch[1];
        
        // Resolve .txt playlist redirection if needed
        if (rawFile.toLowerCase().split('?')[0].endsWith(".txt")) {
          const plResponse = await PotokSDK.http.get(rawFile, { ...headers, "Referer": embedUrl });
          if (plResponse.status === 200) {
            try {
              // Strip UTF-8 BOM if present
              let cleanData = plResponse.data;
              if (cleanData.charCodeAt(0) === 0xFEFF) {
                cleanData = cleanData.substring(1);
              }
              const plObj = JSON.parse(cleanData);
              if (plObj && plObj.playlist && plObj.playlist.length > 0) {
                rawFile = plObj.playlist[plObj.playlist.length - 1].file;
              }
            } catch (jsonErr) {
              console.error("[Kinotochka] JSON playlist parsing failed:", jsonErr);
            }
          }
        }

        // Extract MP4 URLs
        const urls = this.extractUrls(rawFile);
        if (urls.length === 0) return [];

        const streams = [];
        const qualityMap = this.allQualities(urls);

        for (const [quality, rawUrl] of Object.entries(qualityMap)) {
          streams.push({
            provider: this.id,
            quality: quality,
            voice: "Original (Kinovibe)",
            label: "Kinotochka",
            url: rawUrl,
            kind: "mp4",
            headers: headers
          });
        }
        return streams;
      } else {
        // Serial lookup
        const seasonsUrl = `${this.host}/api/find-by-kinopoisk.php?kinopoisk=${kpId}`;
        const response = await PotokSDK.http.get(seasonsUrl, headers);
        if (response.status !== 200) return [];

        let searchItems = [];
        try {
          searchItems = JSON.parse(response.data);
        } catch {
          return [];
        }

        // Find matches for requested season
        const targetSeason = query.season || 1;
        let seasonUrl = "";
        for (const item of searchItems) {
          const match = item.url.match(/-([0-9]+)-sezon/);
          if (match && parseInt(match[1], 10) === targetSeason) {
            seasonUrl = item.url;
            break;
          }
        }
        if (!seasonUrl && searchItems.length > 0) {
          seasonUrl = searchItems[0].url; // Fallback
        }
        if (!seasonUrl) return [];

        // Fetch season page to extract playlist URL
        const seasonPage = await PotokSDK.http.get(seasonUrl, headers);
        if (seasonPage.status !== 200) return [];

        const playlistMatch = seasonPage.data.match(/file:"(https?:\/\/[^"]+\.txt)"/);
        if (!playlistMatch) return [];

        const playlistUrl = playlistMatch[1];
        const plResponse = await PotokSDK.http.get(playlistUrl, { ...headers, "Referer": seasonUrl });
        if (plResponse.status !== 200) return [];

        let cleanData = plResponse.data;
        if (cleanData.charCodeAt(0) === 0xFEFF) {
          cleanData = cleanData.substring(1);
        }

        let playlist = [];
        try {
          const parsed = JSON.parse(cleanData);
          playlist = parsed.playlist || [];
        } catch {
          return [];
        }

        const streams = [];
        const targetEpisode = query.episode || 1;

        for (let i = 0; i < playlist.length; i++) {
          const item = playlist[i];
          let epNum = i + 1;
          const comment = item.comment || "";
          const match = comment.match(/^\s*([0-9]+)/);
          if (match) {
            epNum = parseInt(match[1], 10);
          }

          if (epNum !== targetEpisode) continue;

          const rawFile = item.file || "";
          const urls = this.extractUrls(rawFile);
          if (urls.length === 0) continue;

          // Replace playlist tail [...,1080].mp4 using Go regex port
          let bestUrl = urls[urls.length - 1]; // fallback best
          for (const u of urls) {
            if (u.includes("1080")) bestUrl = u;
          }

          let streamUrl = bestUrl.replace(/\[[^\]]+,([0-9]+)\]\.mp4$/, "$1.mp4");
          if (!streamUrl) streamUrl = rawFile.replace(/\[[^\]]+,([0-9]+)\]\.mp4$/, "$1.mp4");

          streams.push({
            provider: this.id,
            quality: this.qualityLabel(bestUrl) || "720p",
            voice: "Kinovibe Voice",
            label: `S${targetSeason}E${epNum}`,
            url: streamUrl,
            kind: "mp4",
            headers: headers
          });
        }
        return streams;
      }
    } catch (err) {
      console.error("[Kinotochka] Search failed:", err);
      return [];
    }
  }

  extractUrls(raw) {
    if (!raw) return [];
    // Clean escape chars
    let cleaned = raw.replace(/\\+/g, "/").replace(/\\/g, "/").replace(/\\u0026/g, "&");
    const matches = cleaned.match(/https?:\/\/[^\s"'<>\\,]+/g) || [];
    return Array.from(new Set(matches.map(m => m.replace(/[,]$/, ""))));
  }

  qualityLabel(u) {
    const l = u.toLowerCase();
    if (l.includes("2160") || l.includes("4k")) return "2160p";
    if (l.includes("1440")) return "1440p";
    if (l.includes("1080")) return "1080p";
    if (l.includes("720")) return "720p";
    if (l.includes("480")) return "480p";
    if (l.includes("360")) return "360p";
    return "";
  }

  allQualities(urls) {
    const qualities = {};
    for (const u of urls) {
      const label = this.qualityLabel(u);
      if (label) {
        qualities[label] = u;
      }
    }
    if (Object.keys(qualities).length === 0 && urls.length > 0) {
      qualities["720p"] = urls[urls.length - 1];
    }
    return qualities;
  }
}
