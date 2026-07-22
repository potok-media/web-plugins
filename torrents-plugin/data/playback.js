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

// extractExternalQuery pulls the external-track params (xa=/xs=) off an episode's HLS url. getEpisodes bakes
// them there; resolvePlaybackBase re-attaches xa to the rebuilt stream url (it survives the player's resume /
// autoplay round-trip verbatim), and getPlaybackMetadata reads xs to fetch external subtitle tracks.
function extractExternalQuery(url) {
  const out = { xa: "", xs: "", raw: "" };
  if (!url) return out;
  const qi = url.indexOf("?");
  if (qi < 0) return out;
  const keep = [];
  for (const kv of url.slice(qi + 1).split("&")) {
    if (kv.startsWith("xa=")) { out.xa = kv.slice(3); keep.push(kv); }
    else if (kv.startsWith("xs=")) { out.xs = kv.slice(3); keep.push(kv); }
  }
  out.raw = keep.join("&");
  return out;
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
  const external = extractExternalQuery(episode && episode.url);
  let hlsUrl = (cleanTorrUrl && fileIndex)
    ? TorrentParser.buildHlsUrl(cleanTorrUrl, hash, fileIndex)
    : ((episode && episode.url) || stream.url || stream.streamUrl || "");
  // The rebuilt url drops the query — re-attach the sidecar params so external dubs (?xa=) reach the HLS master
  // even on the resume / autoplay paths that reconstruct from episode.url.
  if (external.raw && cleanTorrUrl && fileIndex) {
    hlsUrl += (hlsUrl.includes("?") ? "&" : "?") + external.raw;
  }
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
  return { cleanTorrUrl, fileIndex, hash, hlsUrl, hasBackend, session, thumbnails, externalSubs: external.xs };
}

// The DEFERRED slow half: probe TorrentGo /metadata for subtitle tracks + duration (needs the container header
// resident, so cold-start slow). `xs` (external subtitle FILE indices) is passed through so /metadata also
// returns those sidecar tracks. Returns {} on any failure (degraded: player keeps playing, no menus).
async function fetchPlaybackMetadata(cleanTorrUrl, hash, fileIndex, xs) {
  if (!cleanTorrUrl || !fileIndex) return {};
  try {
    let metadataUrl = `${cleanTorrUrl}/api/torrents/${hash}/files/${fileIndex}/metadata`;
    if (xs) metadataUrl += `?xs=${xs}`;
    const metadataResponse = await PotokSDK.http.get(metadataUrl);
    const metadata = (metadataResponse && metadataResponse.status === 200) ? parseJson(metadataResponse) : null;
    if (!metadata) return {};

    const duration = (typeof metadata.duration === 'number') ? metadata.duration : undefined;
    let subtitles = undefined;
    if (Array.isArray(metadata.tracks)) {
      // Audio tracks are NOT listed here (HLS master carries them). Subtitle tracks are either embedded
      // (windowed extraction) or EXTERNAL files (sourceFile>0 → the whole-file endpoint).
      subtitles = metadata.tracks
        .filter(t => t.type === 'subtitle')
        .map((t, i) => {
          const rel = (typeof t.relIndex === 'number') ? t.relIndex : i;
          const codec = (t.codec || '').toLowerCase();
          const format = (codec === 'ass' || codec === 'ssa') ? 'ass' : 'vtt';
          const external = typeof t.sourceFile === 'number' && t.sourceFile > 0;
          return {
            id: external ? `x${t.sourceFile}` : String(rel),
            // Embedded: base URL, player appends `?format=&start=<bucket>` per window. External: whole-file
            // endpoint keyed by the sidecar's torrent index (it ignores ?start=, returns the full doc).
            src: external
              ? TorrentParser.buildExternalSubtitleUrl(cleanTorrUrl, hash, t.sourceFile)
              : TorrentParser.buildSubtitleBaseUrl(cleanTorrUrl, hash, fileIndex, rel),
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
  const { cleanTorrUrl, fileIndex, hash, externalSubs } = await resolvePlaybackBase(stream, episode);
  return fetchPlaybackMetadata(cleanTorrUrl, hash, fileIndex, externalSubs);
}
