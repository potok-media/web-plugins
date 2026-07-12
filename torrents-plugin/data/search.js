import { PotokSDK } from 'potok-sdk';
import { TorrentParser } from '../utils/parser.js';
import { parseJson } from '../utils/http.js';
import { resolveSearchEngineUrl } from '../utils/config.js';

// --- relevance filter -------------------------------------------------------
// SearchEngine returns fuzzy matches — searching KonoSuba ("Да благословят боги сей расчудесный мир!") also
// yields "Да, я паук, и что?" / "Да, я Сакамото, и что?" (matched on the shared leading word). We know the
// query, so drop results that share ZERO significant title tokens with it. Conservative: only kills clear
// mismatches, and does nothing when the query title is too short to discriminate safely.
const RELEVANCE_STOPWORDS = new Set(["да", "и", "что", "я", "в", "на", "с", "the", "a", "of", "on", "this", "from", "от", "за", "по"]);

function relevanceTokens(s) {
  return (s || "").toLowerCase()
    .replace(/[!?.,:;/()\[\]{}|"“”«»_+\-]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !RELEVANCE_STOPWORDS.has(w) && !/^\d+$/.test(w));
}

export function filterRelevantResults(results, queryTitle) {
  const expected = new Set(relevanceTokens(queryTitle));
  if (expected.size < 2) return results; // too short/ambiguous → don't risk false drops
  return results.filter(t => {
    const res = relevanceTokens(t.title);
    for (const w of res) if (expected.has(w)) return true; // ≥1 shared significant token → keep
    return false; // zero overlap → a different show
  });
}

// --- result mapping ---------------------------------------------------------
function baseTorrent(t) {
  const hash = (t.id || "").toLowerCase();
  return {
    title: t.title,
    url: t.link,
    magnet: t.magnetUri,
    sizeBytes: typeof t.sizeBytes === "number" ? t.sizeBytes : undefined,
    size: typeof t.sizeBytes === "number" ? t.sizeBytes : undefined,
    sizeLabel: t.sizeLabel || "",
    seeders: typeof t.seeders === "number" ? t.seeders : 0,
    seeds: typeof t.seeders === "number" ? t.seeders : 0,
    leechers: typeof t.leechers === "number" ? t.leechers : 0,
    peers: typeof t.leechers === "number" ? t.leechers : 0,
    tracker: t.tracker || "SearchEngine",
    provider: t.tracker || "SearchEngine",
    tags: Array.isArray(t.tags) ? [...t.tags] : [],
    publishDate: t.publishDate || "",
    hash,
    kind: "torrent"
  };
}

// Enrich a mapped torrent from its FULL release title with the local regex parser — NOT parseEpisode, which
// path-splits on "/", but in a release title "/" separates LANGUAGES, not folders. Season 0 never leaks into
// a filter bucket; OVAs are not TV seasons. Deterministic, offline, no tokens.
function enrichFromTitle(bt, title) {
  const parsed = TorrentParser.extractSeasonEpisode(title);
  bt.parsedKind = parsed.kind;
  bt.ovaNumber = parsed.ovaNumber;
  bt.season = (Number.isInteger(parsed.season) && parsed.season > 0) ? parsed.season : undefined;
  bt.seasons = (parsed.seasons && parsed.seasons.length > 0)
    ? parsed.seasons
    : (bt.season !== undefined ? [bt.season] : undefined);
  bt.episode = parsed.episode;

  const quality = TorrentParser.extractQualityTags(title);
  bt.resolution = quality.resolution;
  bt.codec = quality.codec;
  bt.year = quality.year;

  const tagsSet = new Set(bt.tags);
  if (quality.resolution) tagsSet.add(quality.resolution);
  if (quality.codec) tagsSet.add(quality.codec.toUpperCase());
  if (quality.year) tagsSet.add(String(quality.year));
  if (parsed.kind === "ova") tagsSet.add(parsed.ovaNumber ? "OVA-" + parsed.ovaNumber : "OVA");
  else if (parsed.kind === "movie") tagsSet.add("Movie");
  bt.tags = Array.from(tagsSet);
  return bt;
}

// Pre-filter to a specific season when the query asks for one. OVAs/specials aren't TV seasons: an OVA-N shows
// ONLY under its Season N; a number-less OVA stays under no specific season (still in "All seasons").
function applySeasonFilter(results, season) {
  const target = Number(season);
  return results.filter(t => {
    if (t.parsedKind === "ova") return t.ovaNumber === target;
    if (t.seasons) return t.seasons.includes(target);
    if (t.season !== undefined && t.season !== null) return t.season === target;
    return true; // genuinely season-less TV release → keep (rare uploads)
  });
}

export async function search(query) {
  const searchEngineUrl = await resolveSearchEngineUrl();
  if (!searchEngineUrl) {
    throw new Error(PotokSDK.i18n.t("potok-torrents:errors.noSearchUrl"));
  }

  const res = await PotokSDK.http.post(`${searchEngineUrl}/api/v1/torrents/search`, {
    query: query.title,
    mediaType: query.type === "tv" ? "tv" : "movie",
    id: Number(query.tmdbId),
    season: query.season,
    episode: query.episode,
    forceSearch: !!query.forceSearch
  });
  if (res.status !== 200) {
    throw new Error(`Status code: ${res.status}`);
  }

  const data = parseJson(res);
  const relevant = filterRelevantResults(data.results || [], query.title);
  let mapped = relevant.map(t => enrichFromTitle(baseTorrent(t), t.title));
  if (query.season !== undefined && query.season !== null) {
    mapped = applySeasonFilter(mapped, query.season);
  }
  return mapped;
}
