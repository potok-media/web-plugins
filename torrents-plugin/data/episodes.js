import { PotokSDK } from 'potok-sdk';
import { TorrentParser } from '../utils/parser.js';
import { parseJson } from '../utils/http.js';
import { cleanHash, streamHash } from '../utils/hash.js';
import { resolveTorrUrl, resolveSearchEngineUrl } from '../utils/config.js';
import { applyArmMetadata, positiveId } from '../utils/armMetadata.js';
import { loadArmLayout } from './arm.js';
import { applyEpisodeBindings, buildReleaseManifest, rawCompatibilityProjection } from '../utils/releaseManifest.js';
import { attachExternalTracks } from './externalTracks.js';

const SENTINEL = "_"; // group key for files with no parseable season

// Fetch transport files and saved overrides. ARM supplies episodic structure and metadata.
async function fetchTorrentData(stream, context, cleanTorrUrl, hash) {
  const requestBody = {
    title: stream.title,
    link: stream.url || "",
    magnetUri: stream.magnet || "",
    mediaType: context.type,
    tmdbId: positiveId(context.tmdbId)
  };
  const filesUrl = `${cleanTorrUrl.replace(/\/$/, "")}/api/torrents`;
  // Overrides live in the SearchEngine (moved out of the gateway); skip gracefully if it isn't configured.
  const searchEngineUrl = await resolveSearchEngineUrl();
  const overridePromise = searchEngineUrl
    ? PotokSDK.http.get(`${searchEngineUrl}/api/v1/torrents/overrides/${hash}`).catch(() => null)
    : Promise.resolve(null);

  const [filesResponse, overrideRes] = await Promise.all([
    PotokSDK.http.post(filesUrl, requestBody, undefined, 90_000),
    overridePromise,
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
  return { rawFiles, audioFiles, subtitleFiles, authHash, seasonMap, fileMap };
}

async function resolveReleaseManifest(manifest) {
  try {
    const response = await PotokSDK.http.post('/api/arm/v1/releases/resolve', manifest, undefined, 30_000);
    const resolution = response?.status === 200 ? parseJson(response) : null;
    if (!resolution || resolution.releaseId !== manifest.releaseId
      || (manifest.workId && resolution.workId && resolution.workId !== manifest.workId)
      || (manifest.orderingId && resolution.orderingId && resolution.orderingId !== manifest.orderingId)) return null;
    return resolution;
  } catch {
    // A transport outage must not prevent playing the original torrent files.
    return null;
  }
}

// Remap files to (season, episode). Priority per file, walked in TORRENT ORDER so anchor runs can carry state:
//   1. file_map PIN     — this one file is fixed at (season, episode); does NOT advance the anchor run (specials).
//   2. file_map ANCHOR  — «from this file: SxEy»; starts a run, each following non-overridden file increments.
//   3. active anchor run — inherits the run's season, episode = base + count.
//   4. season_map        — coarse per-source-season offset (displayedEpisode = parsedEpisode + offset).
//   5. auto-parse        — the file's own parsed season/episode, with a release-title season fallback.
// Each file always keeps its RAW parsed season/episode (the override editor computes offsets against that raw).
function remapFiles(rawFiles, seasonMap, fileMap, context, stream, titleSeason) {
  const groupCounts = {};
  let anchor = null; // active anchor run: { season, baseEp, seen }
  return rawFiles.map((file) => {
    let filePath = file.path || file.title || "";
    if (!filePath.includes("/")) {
      filePath = stream.title ? `${stream.title}/${filePath}` : filePath;
    }
    const parsed = TorrentParser.parseEpisode(filePath, context.type);
    const key = parsed.season !== undefined ? String(parsed.season) : SENTINEL;
    const idxInGroup = (groupCounts[key] = (groupCounts[key] ?? 0));
    groupCounts[key] = idxInGroup + 1;

    // Canonical overrides are applied only by the Gateway; an unavailable/stale ARM
    // response must not fabricate an Episode ID or revive an older numeric assignment.
    const saved = fileMap[String(file.id)];
    const fileOv = saved && !saved.armTarget && Number.isInteger(saved.season)
      && Number.isFinite(saved.episode) ? saved : null;
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
      // A release-title season is evidence and may fill a missing file season. With no such evidence TV stays
      // unresolved: never fabricate season 1 merely because the legacy UI expects a numeric coordinate.
      ({ season, episode } = rawCompatibilityProjection({
        mediaType: context.type,
        parsed,
        titleSeason,
        indexInGroup: idxInGroup,
      }));
    }
    return {
      ...file,
      season,
      episode,
      rawSeason: parsed.season,
      rawEpisode: parsed.episode,
      rawEvidence: { kind: parsed.kind, season: parsed.season, episode: parsed.episode, episodeEnd: parsed.episodeEnd, ovaNumber: parsed.ovaNumber },
      // Preserve the file name separately from the ARM episode title.
      fileName: file.title || (file.path ? file.path.split(/[\\/]/).pop() : undefined),
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
  // Opaque progress identity: the host stores/resumes per-file progress under this token verbatim and never
  // learns it is `<infohash>:<fileIndex>`. getPlaybackInfo echoes it back so read and write keys always match.
  const pid = cleanHash(authHash);
  return cleanedFiles.map((f) => ({
    id: String(f.id),
    season: f.season,
    episode: f.episode,
    rawSeason: f.rawSeason,
    rawEpisode: f.rawEpisode,
    rawEvidence: f.rawEvidence,
    title: f.title || `${fileLabel} ${f.id}`,
    fileName: f.fileName,
    sizeLabel: formatSize(f.sizeBytes),
    isWatched: false,
    torrentHash: authHash,
    workId: f.workId,
    episodeId: f.episodeId,
    orderingId: f.orderingId,
    groupId: f.groupId,
    resolutionState: f.resolutionState,
    confidence: f.confidence,
    bindingMethod: f.bindingMethod,
    alternatives: f.alternatives,
    progressId: pid ? `${pid}:${String(f.id)}` : undefined,
    url: TorrentParser.buildHlsUrl(cleanTorrUrl, authHash, String(f.id), f.externalTracks)
  }));
}

export async function getEpisodes(stream, context) {
  const cleanTorrUrl = await resolveTorrUrl();
  if (!cleanTorrUrl) {
    throw new Error(PotokSDK.i18n.t("potok-torrents:errors.noTorrUrl"));
  }
  const hash = streamHash(stream);
  const { rawFiles, audioFiles, subtitleFiles, authHash, seasonMap, fileMap } = await fetchTorrentData(stream, context, cleanTorrUrl, hash);
  const manifest = buildReleaseManifest({
    releaseId: authHash || hash,
    releaseTitle: stream.title || '',
    workId: context.workId || context.armWorkId || null,
    orderingId: context.orderingId || null,
    providerReference: positiveId(context.tmdbId) == null ? null : {
      provider: 'tmdb',
      entityKind: context.type === 'tv' ? 'tv' : 'movie',
      value: String(context.tmdbId),
    },
    mediaType: context.type,
    files: rawFiles,
    fileOverrides: fileMap,
    sectionOverrides: seasonMap,
  });
  const releaseResolutionPromise = resolveReleaseManifest(manifest);
  const titleSeason = context.type === "tv"
    ? TorrentParser.extractSeasonEpisode(stream.title || "").season
    : undefined;
  const refinedFiles = remapFiles(rawFiles, seasonMap, fileMap, context, stream, titleSeason);
  const cleanedFiles = TorrentParser.cleanTitles(refinedFiles);
  const hasExternal = audioFiles.length > 0 || subtitleFiles.length > 0;
  const filesWithExternal = hasExternal
    ? attachExternalTracks(cleanedFiles, audioFiles, subtitleFiles, context, stream)
    : cleanedFiles;

  let episodes = mapEpisodes(filesWithExternal, cleanTorrUrl, authHash);
  const releaseResolution = await releaseResolutionPromise;
  episodes = applyEpisodeBindings(episodes, releaseResolution);
  if (releaseResolution?.bindings?.some((binding) => binding.state === "resolved")) {
    const layout = await loadArmLayout(releaseResolution);
    episodes = applyArmMetadata(episodes, releaseResolution, layout, positiveId(context.tmdbId));
  }

  return {
    episodes,
    seasonMap,
    fileMap,
    parsingSuspect: context.type === "tv" && episodes.some((episode) => episode.resolutionState !== "resolved"),
    arm: releaseResolution ? {
      state: String(releaseResolution.state || 'unresolved').toLowerCase(),
      workId: releaseResolution.workId || null,
      orderingId: releaseResolution.orderingId || null,
      graphVersion: releaseResolution.graphVersion || null,
    } : null,
  };
}
