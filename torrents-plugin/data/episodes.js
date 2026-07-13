import { PotokSDK } from 'potok-sdk';
import { TorrentParser } from '../utils/parser.js';
import { parseJson } from '../utils/http.js';
import { cleanHash, streamHash } from '../utils/hash.js';
import { resolveTorrUrl, resolveSearchEngineUrl } from '../utils/config.js';
import { applyTMDBMetadata } from '../utils/metadata.js';

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
  const seasonMap = (overrideRes && overrideRes.status === 200 && (parseJson(overrideRes) || {}).seasonMap) || {};
  const loadedTotalSeasons = (detailRes && detailRes.status === 200 && (parseJson(detailRes) || {}).numberOfSeasons) || 1;
  return { rawFiles, authHash, seasonMap, loadedTotalSeasons };
}

// Per-SOURCE-season remap. Parse each file by NAME only, group by its RAW source-season key (sentinel "_" = no
// season), then apply the map entry for that key: displayedEpisode = parsedEpisode + offset. The offset was
// computed by the UI on RAW parsed episodes so it never compounds; files with no parsed episode fall back to
// sequential numbering WITHIN their key group. Each file keeps its RAW parsed season/episode.
function remapFiles(rawFiles, seasonMap, context, stream, loadedTotalSeasons, titleSeason) {
  const groupCounts = {};
  return rawFiles.map((file) => {
    let filePath = file.path || file.title || "";
    if (!filePath.includes("/")) {
      filePath = stream.title ? `${stream.title}/${filePath}` : filePath;
    }
    const parsed = TorrentParser.parseEpisode(filePath, context.type, context.type === "tv" ? loadedTotalSeasons : undefined);
    const key = parsed.season !== undefined ? String(parsed.season) : SENTINEL;
    const idxInGroup = (groupCounts[key] = (groupCounts[key] ?? 0));
    groupCounts[key] = idxInGroup + 1;

    const entry = seasonMap[key];
    let season, episode;
    if (entry) {
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

// Build the episode descriptors the host/player consume (each carries its authoritative HLS url).
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
    isWatched: false,
    torrentHash: authHash,
    url: TorrentParser.buildHlsUrl(cleanTorrUrl, authHash, String(f.id))
  }));
}

export async function getEpisodes(stream, context) {
  const cleanTorrUrl = await resolveTorrUrl();
  if (!cleanTorrUrl) {
    throw new Error(PotokSDK.i18n.t("potok-torrents:errors.noTorrUrl"));
  }
  const hash = streamHash(stream);
  const { rawFiles, authHash, seasonMap, loadedTotalSeasons } = await fetchTorrentData(stream, context, cleanTorrUrl, hash);

  // Season declared in the torrent TITLE (not the file names). Used both as a fallback for season-less files
  // and to judge whether the parse is trustworthy (see parsingSuspect below). Parser stays plugin-owned.
  const titleSeason = context.type === "tv"
    ? TorrentParser.extractSeasonEpisode(stream.title || "").season
    : undefined;

  const refinedFiles = remapFiles(rawFiles, seasonMap, context, stream, loadedTotalSeasons, titleSeason);
  const cleanedFiles = TorrentParser.cleanTitles(refinedFiles);
  let episodes = mapEpisodes(cleanedFiles, cleanTorrUrl, authHash);
  episodes = await applyTMDBMetadata(episodes, context.tmdbId, context.type);

  // Parse-quality verdict, computed where the parser + title live (the host stays regex-free). Suspect when the
  // title clearly declares a season the files never resolved to — i.e. the file-name parse disagrees with the
  // release's own stated season. Skipped when the user has a manual override (their mapping is authoritative).
  const resolvedSeasons = new Set(episodes.map((e) => e.season));
  const parsingSuspect =
    context.type === "tv" &&
    Object.keys(seasonMap).length === 0 &&
    titleSeason !== undefined && titleSeason > 0 &&
    !resolvedSeasons.has(titleSeason);

  return { episodes, tmdbSeasonsCount: loadedTotalSeasons, seasonMap, parsingSuspect };
}
