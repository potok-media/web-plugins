import { PotokSDK } from 'potok-sdk';
import { TorrentParser } from '../utils/parser.js';
import { parseJson } from '../utils/http.js';
import { cleanHash, streamHash } from '../utils/hash.js';
import { resolveTorrUrl, resolveSearchEngineUrl } from '../utils/config.js';
import { applyTMDBMetadata } from '../utils/metadata.js';
import { attachExternalTracks } from './externalTracks.js';

const SENTINEL = "_"; // group key for files with no parseable season

// Fetch the torrent's files + the per-season override map + the show's season count, in parallel. Returns the
// raw material remapFiles/mapEpisodes need. Throws the i18n'd TorrentGo / no-media errors.
async function fetchTorrentData(stream, context, cleanTorrUrl, hash) {
  const requestBody = {
    title: stream.title,
    link: stream.url || "",
    magnetUri: stream.magnet || "",
    mediaType: context.type,
    tmdbId: Number(context.tmdbId)
  };
  const filesUrl = `${cleanTorrUrl.replace(/\/$/, "")}/api/torrents`;
  // Overrides live in the SearchEngine (moved out of the gateway); skip gracefully if it isn't configured.
  const searchEngineUrl = await resolveSearchEngineUrl();
  const overridePromise = searchEngineUrl
    ? PotokSDK.http.get(`${searchEngineUrl}/api/v1/torrents/overrides/${hash}`).catch(() => null)
    : Promise.resolve(null);

  const [filesResponse, overrideRes, detailRes] = await Promise.all([
    PotokSDK.http.post(filesUrl, requestBody),
    overridePromise,
    PotokSDK.http.get(`/api/media/detail/${context.type === "tv" ? "tv" : "movie"}/${context.tmdbId}`).catch(() => null)
  ]);

  if (filesResponse.status !== 200) {
    throw new Error(PotokSDK.i18n.t("potok-torrents:errors.torrGoError", { status: filesResponse.status }));
  }
  const resJson = parseJson(filesResponse);
  const rawFiles = resJson.items || [];
  if (rawFiles.length === 0) {
    throw new Error(PotokSDK.i18n.t("potok-torrents:errors.noMediaFiles"));
  }

  const authHash = cleanHash(resJson.hash) || hash;
  // External (sidecar) dub/subtitle files for "ext" releases — separate lists the backend returns alongside the
  // video items. Empty for normal releases.
  const audioFiles = resJson.audioFiles || [];
  const subtitleFiles = resJson.subtitleFiles || [];
  const overrideJson = (overrideRes && overrideRes.status === 200 && parseJson(overrideRes)) || {};
  const seasonMap = overrideJson.seasonMap || {};
  const fileMap = overrideJson.fileMap || {};
  const loadedTotalSeasons = (detailRes && detailRes.status === 200 && (parseJson(detailRes) || {}).numberOfSeasons) || 1;
  return { rawFiles, audioFiles, subtitleFiles, authHash, seasonMap, fileMap, loadedTotalSeasons };
}

// Remap files to (season, episode). Priority per file, walked in TORRENT ORDER so anchor runs can carry state:
//   1. file_map PIN     — this one file is fixed at (season, episode); does NOT advance the anchor run (specials).
//   2. file_map ANCHOR  — «from this file: SxEy»; starts a run, each following non-overridden file increments.
//   3. active anchor run — inherits the run's season, episode = base + count.
//   4. season_map        — coarse per-source-season offset (displayedEpisode = parsedEpisode + offset).
//   5. auto-parse        — the file's own parsed season/episode, with the title-season fallback + sequential fill.
// Each file always keeps its RAW parsed season/episode (the override editor computes offsets against that raw).
function remapFiles(rawFiles, seasonMap, fileMap, context, stream, loadedTotalSeasons, titleSeason) {
  const groupCounts = {};
  let anchor = null; // active anchor run: { season, baseEp, seen }
  return rawFiles.map((file) => {
    let filePath = file.path || file.title || "";
    if (!filePath.includes("/")) {
      filePath = stream.title ? `${stream.title}/${filePath}` : filePath;
    }
    const parsed = TorrentParser.parseEpisode(filePath, context.type, context.type === "tv" ? loadedTotalSeasons : undefined);
    const key = parsed.season !== undefined ? String(parsed.season) : SENTINEL;
    const idxInGroup = (groupCounts[key] = (groupCounts[key] ?? 0));
    groupCounts[key] = idxInGroup + 1;

    const fileOv = fileMap[String(file.id)];
    const entry = seasonMap[key];
    let season, episode;
    if (fileOv && fileOv.mode === "pin") {
      // Point override — the run keeps counting AS IF this file weren't there (pulled-out special).
      season = fileOv.season;
      episode = fileOv.episode;
    } else if (fileOv && fileOv.mode === "anchor") {
      anchor = { season: fileOv.season, baseEp: fileOv.episode, seen: 1 };
      season = fileOv.season;
      episode = fileOv.episode;
    } else if (anchor) {
      season = anchor.season;
      episode = anchor.baseEp + anchor.seen;
      anchor.seen += 1;
    } else if (entry) {
      season = entry.season;
      episode = parsed.episode !== undefined ? parsed.episode + entry.offset : (1 + entry.offset + idxInGroup);
    } else {
      // Season fallback for files that carry no parseable season: prefer the season DECLARED in the torrent
      // title (e.g. «ТВ-3» / «3rd Season» → 3) over a blind default of 1 — fixes releases whose file names
      // only carry the episode («… Seikatsu III - 01»), not the season.
      season = parsed.season !== undefined
        ? parsed.season
        : (context.type === "tv" ? (titleSeason && titleSeason > 0 ? titleSeason : 1) : 0);
      episode = parsed.episode !== undefined ? parsed.episode : (1 + idxInGroup);
    }
    return {
      ...file,
      season,
      episode,
      rawSeason: parsed.season,
      rawEpisode: parsed.episode,
      // Keep the ORIGINAL file name before cleanTitles trims it / applyTMDBMetadata overwrites `title`.
      fileName: file.title || (file.path ? file.path.split("/").pop() : undefined),
      isSerial: parsed.isSerial
    };
  });
}

// Human-readable file size. Specials are visually ~10× smaller than main episodes, so surfacing this in the
// row is a strong at-a-glance "this isn't a full episode" cue. Decimal units to match typical torrent UIs.
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return undefined;
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

// Build the episode descriptors the host/player consume (each carries its authoritative HLS url). `f.externalTracks`
// ({audio,subs} torrent indices) is folded into the url as ?xa=/?xs= so the backend surfaces the sidecar dubs/subs.
function mapEpisodes(cleanedFiles, cleanTorrUrl, authHash) {
  const fileLabel = PotokSDK.i18n.t("potok-torrents:ui.file");
  return cleanedFiles.map((f) => ({
    id: String(f.id),
    season: f.season,
    episode: f.episode,
    rawSeason: f.rawSeason,
    rawEpisode: f.rawEpisode,
    title: f.title || `${fileLabel} ${f.id}`,
    fileName: f.fileName,
    sizeLabel: formatSize(f.sizeBytes),
    isWatched: false,
    torrentHash: authHash,
    url: TorrentParser.buildHlsUrl(cleanTorrUrl, authHash, String(f.id), f.externalTracks)
  }));
}

export async function getEpisodes(stream, context) {
  const cleanTorrUrl = await resolveTorrUrl();
  if (!cleanTorrUrl) {
    throw new Error(PotokSDK.i18n.t("potok-torrents:errors.noTorrUrl"));
  }
  const hash = streamHash(stream);
  const { rawFiles, audioFiles, subtitleFiles, authHash, seasonMap, fileMap, loadedTotalSeasons } = await fetchTorrentData(stream, context, cleanTorrUrl, hash);

  // Season declared in the torrent TITLE (not the file names). Used both as a fallback for season-less files
  // and to judge whether the parse is trustworthy (see parsingSuspect below). Parser stays plugin-owned.
  const titleSeason = context.type === "tv"
    ? TorrentParser.extractSeasonEpisode(stream.title || "").season
    : undefined;

  const refinedFiles = remapFiles(rawFiles, seasonMap, fileMap, context, stream, loadedTotalSeasons, titleSeason);
  const cleanedFiles = TorrentParser.cleanTitles(refinedFiles);

  // Pair external (sidecar) dub/subtitle files to each video file by raw parsed (season, episode). A single-video
  // torrent (movie / one file) takes ALL sidecars regardless of how their names parse.
  const hasExternal = audioFiles.length > 0 || subtitleFiles.length > 0;
  const filesWithExternal = hasExternal
    ? attachExternalTracks(cleanedFiles, audioFiles, subtitleFiles, context, stream, loadedTotalSeasons)
    : cleanedFiles;

  let episodes = mapEpisodes(filesWithExternal, cleanTorrUrl, authHash);
  episodes = await applyTMDBMetadata(episodes, context.tmdbId, context.type);

  // Parse-quality verdict, computed where the parser + title live (the host stays regex-free). Suspect when the
  // title clearly declares a season the files never resolved to — i.e. the file-name parse disagrees with the
  // release's own stated season. Skipped when the user has a manual override (their mapping is authoritative).
  const resolvedSeasons = new Set(episodes.map((e) => e.season));
  const parsingSuspect =
    context.type === "tv" &&
    Object.keys(seasonMap).length === 0 &&
    Object.keys(fileMap).length === 0 &&
    titleSeason !== undefined && titleSeason > 0 &&
    !resolvedSeasons.has(titleSeason);

  return { episodes, tmdbSeasonsCount: loadedTotalSeasons, seasonMap, fileMap, parsingSuspect };
}
