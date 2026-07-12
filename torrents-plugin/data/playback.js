import { PotokSDK } from 'potok-sdk';
import { TorrentParser } from '../utils/parser.js';
import { parseJson } from '../utils/http.js';
import { cleanHash, parseHashFromUrl } from '../utils/hash.js';
import { resolveTorrUrl } from '../utils/config.js';
import { logger } from '../utils/logger.js';

// --- subtitle labels --------------------------------------------------------
// Human language name from an ISO code via Intl.DisplayNames (dynamic locale).
function langName(code) {
  if (!code) return "";
  const c = String(code).trim().toLowerCase();
  try {
    const locale = PotokSDK.i18n.locale || "en";
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(c);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : c.toUpperCase();
  } catch (e) {
    return c.toUpperCase();
  }
}

// Display-ready subtitle label (plain string — the dumb player just renders it). Audio labels are NOT built
// here: audio renditions live in the HLS master (EXT-X-MEDIA NAME/LANGUAGE) and hls.js exposes them natively.
function buildSubtitleLabel(t, i) {
  const lang = langName(t.language || t.languageCode);
  const codec = (t.codec || "").toUpperCase();
  const title = (t.title || t.name || t.label || "").trim();
  const generic = /^(subtitle|sub|субтитры|саб)\s*#?\d*$/i;
  const rel = (typeof t.relIndex === "number") ? t.relIndex : i;
  const subText = PotokSDK.i18n.t("potok-torrents:ui.subtitles");
  const primary = (title && !generic.test(title)) ? title : (lang || `${subText} #${rel}`);
  return codec ? `${primary} (${codec})` : primary;
}

// --- descriptor resolution --------------------------------------------------
// The SYNCHRONOUS half of a playback descriptor (no I/O): hash, fileIndex, HLS url, session/thumbnails — all
// derivable from the stream/episode alone. getPlaybackInfo returns this instantly so the player opens with its
// waiting overlay; the slow /metadata probe is deferred.
async function resolvePlaybackBase(stream, episode) {
  const cleanTorrUrl = await resolveTorrUrl();
  const fileIndex = String(episode && episode.id != null ? episode.id : "");
  const hash = cleanHash(
    (episode && episode.torrentHash) ||
    parseHashFromUrl(episode && episode.url) ||
    stream.hash || stream.url || stream.magnet || ""
  );
  const hlsUrl = (cleanTorrUrl && fileIndex)
    ? TorrentParser.buildHlsUrl(cleanTorrUrl, hash, fileIndex)
    : ((episode && episode.url) || stream.url || stream.streamUrl || "");
  const hasBackend = !!(cleanTorrUrl && fileIndex && hash);
  const session = hasBackend
    ? {
        keepaliveUrl: `${cleanTorrUrl}/api/playback/keepalive`,
        stopUrl: `${cleanTorrUrl}/api/playback/stop`,
        // Generic status endpoint the dumb player polls for warm-up progress (backend peers/speed → generic).
        statusUrl: `${cleanTorrUrl}/api/torrents/${hash}`,
        statusIntervalSec: 2,
        intervalSec: 7,
        hash,
        file: fileIndex,
      }
    : undefined;
  // Generic scrub-preview template ({time} → rounded seconds). The player never learns it's a torrent.
  const thumbnails = hasBackend
    ? { urlTemplate: `${TorrentParser.buildThumbnailBaseUrl(cleanTorrUrl, hash, fileIndex)}?time={time}`, intervalSec: 5 }
    : undefined;
  return { cleanTorrUrl, fileIndex, hash, hlsUrl, hasBackend, session, thumbnails };
}

// The DEFERRED slow half: probe TorrentGo /metadata for subtitle tracks + duration (needs the container header
// resident, so cold-start slow). Returns {} on any failure (degraded: player keeps playing, no menus).
async function fetchPlaybackMetadata(cleanTorrUrl, hash, fileIndex) {
  if (!cleanTorrUrl || !fileIndex) return {};
  try {
    const metadataUrl = `${cleanTorrUrl}/api/torrents/${hash}/files/${fileIndex}/metadata`;
    const metadataResponse = await PotokSDK.http.get(metadataUrl);
    const metadata = (metadataResponse && metadataResponse.status === 200) ? parseJson(metadataResponse) : null;
    if (!metadata) return {};

    const duration = (typeof metadata.duration === 'number') ? metadata.duration : undefined;
    let subtitles = undefined;
    if (Array.isArray(metadata.tracks)) {
      // Audio tracks are NOT listed here (HLS master carries them). Only external subtitle tracks need the
      // plugin↔backend windowed path.
      subtitles = metadata.tracks
        .filter(t => t.type === 'subtitle')
        .map((t, i) => {
          const rel = (typeof t.relIndex === 'number') ? t.relIndex : i;
          const codec = (t.codec || '').toLowerCase();
          const format = (codec === 'ass' || codec === 'ssa') ? 'ass' : 'vtt';
          return {
            id: String(rel),
            // Base URL only — the player appends `?format=&start=<bucket>` per window.
            src: TorrentParser.buildSubtitleBaseUrl(cleanTorrUrl, hash, fileIndex, rel),
            label: buildSubtitleLabel(t, i),
            language: t.language || t.languageCode || '',
            format,
          };
        });
    }
    return { duration, subtitles };
  } catch (err) {
    logger.error("TorrentGo metadata unavailable, degrading to default track:", err);
    return {};
  }
}

// --- provider methods -------------------------------------------------------
// Returns INSTANTLY: everything is derived synchronously from the stream/episode (no /metadata probe), so the
// player opens immediately with its waiting overlay. Subtitles + duration are DEFERRED to getPlaybackMetadata.
export async function getPlaybackInfo(stream, episode, context) {
  const { hlsUrl, hasBackend, session, thumbnails, hash, fileIndex } = await resolvePlaybackBase(stream, episode);

  const base = {
    streamUrl: hlsUrl,
    streamType: "m3u8",
    mediaType: context.type,
    id: Number(context.tmdbId),
    torrentHash: hash,
    fileIndex,
    subtitles: undefined, // deferred → getPlaybackMetadata
    session,
    thumbnails,
    requiresBuffering: hasBackend, // torrent-backed streams warm up → show the loading/progress overlay
    duration: undefined,  // deferred → getPlaybackMetadata (the HLS manifest also provides it)
  };

  if (context.type === "tv") {
    const showTitle = context.title || stream.title || PotokSDK.i18n.t("potok-torrents:ui.serial");
    const seasonNum = episode && episode.season !== undefined ? episode.season : 1;
    const episodeNum = episode && episode.episode !== undefined ? episode.episode : 1;
    const episodeLabel = PotokSDK.i18n.t("potok-torrents:ui.episode");
    const episodeTitle = (episode && episode.title) || `${episodeLabel} ${episodeNum}`;
    const cleanEpisodeTitle = episodeTitle.replace(/^\d+[\s.\-_]+/, "").trim();
    return {
      ...base,
      title: `${showTitle} - S${seasonNum}E${episodeNum} - ${cleanEpisodeTitle}`,
      season: seasonNum,
      episode: episodeNum,
    };
  }
  return {
    ...base,
    title: context.title || stream.title || PotokSDK.i18n.t("potok-torrents:ui.video"),
  };
}

// Deferred slow half of the descriptor: probe TorrentGo /metadata for subtitle tracks + duration. The host
// calls this right after opening the player, then merges the result into the live playback.
export async function getPlaybackMetadata(stream, episode) {
  const { cleanTorrUrl, fileIndex, hash } = await resolvePlaybackBase(stream, episode);
  return fetchPlaybackMetadata(cleanTorrUrl, hash, fileIndex);
}
