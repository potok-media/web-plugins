import { PotokSDK } from 'potok-sdk';
import { TorrentParser } from '../utils/parser.js';
import { parseJson } from '../utils/http.js';
import { resolveSearchEngineUrl } from '../utils/config.js';
import { buildTorrentSearchRequest } from '../utils/searchRequest.js';
import { armSearchContext } from '../utils/armMetadata.js';
import { loadArmWork } from './arm.js';

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

export function filterRelevantResults(results, ...queryTitles) {
  const expected = new Set(queryTitles.flatMap(relevanceTokens));
  if (expected.size < 2) return results; // too short/ambiguous → don't risk false drops
  return results.filter(t => {
    const res = relevanceTokens(t.title);
    for (const w of res) if (expected.has(w)) return true; // ≥1 shared significant token → keep
    return false; // zero overlap → a different show
  });
}

function alternateTitle(query) {
  const local = (query.title || "").trim();
  for (const candidate of [query.englishTitle, query.originalTitle]) {
    const value = (candidate || "").trim();
    if (value && value.toLowerCase() !== local.toLowerCase())
      return value;
  }
  return "";
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
    kind: "torrent",
    // Present when SearchEngine attached maps; omitted/undefined on older engines.
    override: t.override
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

// Legacy-only filter. Specials and OVA ordinals cannot be interpreted as TV season numbers.
function applySeasonFilter(results, season) {
  const target = Number(season);
  return results.filter(t => {
    if (t.parsedKind === "ova" || t.parsedKind === "special" || t.parsedKind === "credits") return true;
    if (t.seasons) return t.seasons.includes(target);
    if (t.season !== undefined && t.season !== null) return t.season === target;
    return true; // genuinely season-less TV release → keep (rare uploads)
  });
}

function searchBody(query) {
  return buildTorrentSearchRequest(query, alternateTitle(query));
}

function mapEngineResults(results, query) {
  const originalTitle = alternateTitle(query);
  const relevant = filterRelevantResults(results || [], query.title, originalTitle, ...(query.searchAliases || []));
  let mapped = relevant.map(t => enrichFromTitle(baseTorrent(t), t.title));
  if (!query.workId && query.season !== undefined && query.season !== null) {
    mapped = applySeasonFilter(mapped, query.season);
  }
  return mapped;
}

function resultKey(item) {
  return (item.hash || item.magnet || item.url || item.title || "").toLowerCase();
}

function appendUnique(acc, incoming) {
  const seen = new Set(acc.map(resultKey));
  for (const item of incoming) {
    const key = resultKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    acc.push(item);
  }
  return acc;
}

async function searchBuffered(searchEngineUrl, query) {
  const res = await PotokSDK.http.post(
    `${searchEngineUrl}/api/v1/torrents/search`,
    searchBody(query),
    undefined,
    90_000,
  );
  if (res.status !== 200) {
    throw new Error(`Status code: ${res.status}`);
  }
  const data = parseJson(res);
  return mapEngineResults(data.results || [], query);
}

export async function search(query, onProgress) {
  query = armSearchContext(query, await loadArmWork(query));
  const searchEngineUrl = await resolveSearchEngineUrl();
  if (!searchEngineUrl) {
    throw new Error(PotokSDK.i18n.t("potok-torrents:errors.noSearchUrl"));
  }

  const accumulated = [];
  const notify = () => {
    if (typeof onProgress === "function") onProgress(accumulated.slice());
  };

  if (typeof PotokSDK.http.streamPost !== "function") return searchBuffered(searchEngineUrl, query);

  try {
    const res = await PotokSDK.http.streamPost(
      `${searchEngineUrl}/api/v1/torrents/search/stream`,
      searchBody(query),
      undefined,
      90_000,
      (event) => {
        if (!event || event.type !== "batch" || !Array.isArray(event.results)) return;
        appendUnique(accumulated, mapEngineResults(event.results, query));
        notify();
      },
    );
    if (res.status === 200) return accumulated;
    if (res.status !== 404 && res.status !== 405) {
      if (accumulated.length > 0) return accumulated;
      throw new Error(`Status code: ${res.status}`);
    }
  } catch {
    if (accumulated.length > 0) return accumulated;
  }

  return searchBuffered(searchEngineUrl, query);
}
