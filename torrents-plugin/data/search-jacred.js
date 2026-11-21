import { PotokSDK } from 'potok-sdk';
import { cleanHash } from '../utils/hash.js';
import { resolveJacredUrl, resolveJacredApiKey } from '../utils/config.js';
import { TorrentParser } from '../utils/parser.js';

// --- JacRed API response → RawStreamPayload mapping ---------------------------
// JacRed returns: { tracker, url, title, size, sizeName, createTime, updateTime, sid, pir,
//                   magnet, name, originalname, relased, videotype, quality, voices, seasons, types }

function mapJacredItem(item, query) {
  // Compute hash from magnet or url
  let hash = '';
  if (item.magnet) {
    hash = cleanHash(item.magnet);
  }
  if (!hash && item.url) {
    const urlMatch = String(item.url).match(/\/(api\/torrents\/)?([0-9a-fA-F]{40})\b/);
    hash = urlMatch ? urlMatch[2].toLowerCase() : '';
  }

  const bt = {
    title: item.title || item.name || '',
    url: item.url || '',
    magnet: item.magnet || '',
    size: item.size || 0,
    sizeBytes: typeof item.size === 'number' ? item.size : (typeof item.size === 'string' ? parseInt(item.size, 10) || 0 : 0),
    sizeLabel: item.sizeName || '',
    seeds: typeof item.sid === 'number' ? item.sid : 0,
    seeders: typeof item.sid === 'number' ? item.sid : 0,
    peers: typeof item.pir === 'number' ? item.pir : 0,
    leechers: typeof item.pir === 'number' ? item.pir : 0,
    tracker: item.tracker || 'JacRed',
    provider: 'JacRed',
    kind: 'torrent',
    hash,
    publishDate: item.createTime || '',
    tags: [],
  };

  // Enrich from title using the same parser as the SearchEngine search
  const parsed = TorrentParser.extractSeasonEpisode(item.title || '');
  bt.parsedKind = parsed.kind;
  bt.ovaNumber = parsed.ovaNumber;
  bt.season = (Number.isInteger(parsed.season) && parsed.season > 0) ? parsed.season : undefined;
  bt.seasons = (parsed.seasons && parsed.seasons.length > 0)
    ? parsed.seasons
    : (bt.season !== undefined ? [bt.season] : undefined);
  bt.episode = parsed.episode;

  const quality = TorrentParser.extractQualityTags(item.title || '');
  bt.resolution = quality.resolution;
  bt.codec = quality.codec;
  bt.year = quality.year;

  // Add extra metadata as tags
  const tagsSet = new Set(bt.tags);
  if (quality.resolution) tagsSet.add(quality.resolution);
  if (quality.codec) tagsSet.add(quality.codec.toUpperCase());
  if (quality.year) tagsSet.add(String(quality.year));
  if (parsed.kind === 'ova') tagsSet.add(parsed.ovaNumber ? 'OVA-' + parsed.ovaNumber : 'OVA');
  else if (parsed.kind === 'movie') tagsSet.add('Movie');

  // Map videotype to resolution tag
  if (item.videotype) {
    tagsSet.add(item.videotype.toUpperCase());
  }

  // Map quality field
  if (item.quality) {
    bt.quality = String(item.quality);
    tagsSet.add(String(item.quality));
  }

  // Add original name
  if (item.originalname) {
    bt.originalname = item.originalname;
  }

  // Add released year
  if (item.relased) {
    bt.year = item.relased;
    bt.releaseYear = item.relased;
    tagsSet.add(String(item.relased));
  }

  // Add voices
  if (Array.isArray(item.voices) && item.voices.length > 0) {
    bt.voices = item.voices;
    for (const voice of item.voices) {
      tagsSet.add(voice);
    }
  }

  // Add types
  if (Array.isArray(item.types) && item.types.length > 0) {
    bt.types = item.types;
  }

  bt.tags = Array.from(tagsSet);
  return bt;
}

// --- JacRed search -------------------------------------------------------------
export async function search(query, onProgress) {
  const jacredUrl = await resolveJacredUrl();
  if (!jacredUrl) {
    throw new Error(PotokSDK.i18n.t('potok-torrents:errors.noJacredUrl'));
  }

  const apiKey = await resolveJacredApiKey();
  const queryTitle = query.title || '';
  if (!queryTitle) return [];

  // Build search URL: GET {jacredUrl}/api/v1.0/torrents?search={name}
  const encodedQuery = encodeURIComponent(queryTitle);
  const url = `${jacredUrl}/api/v1.0/torrents?search=${encodedQuery}`;

  const headers = {};
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  let response;
  try {
    response = await PotokSDK.http.get(url, headers, 30_000);
  } catch (err) {
    throw new Error(err.message || 'JacRed request failed');
  }

  if (response.status !== 200) {
    throw new Error(PotokSDK.i18n.t('potok-torrents:errors.jacredError', { status: response.status }));
  }

  let items;
  try {
    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    items = Array.isArray(data) ? data : (data?.results || data?.items || []);
  } catch {
    throw new Error(PotokSDK.i18n.t('potok-torrents:errors.jacredParseError'));
  }

  if (!Array.isArray(items) || items.length === 0) return [];

  // Map JacRed items to RawStreamPayload format
  const mapped = items.map(item => mapJacredItem(item, query));

  if (typeof onProgress === 'function') {
    onProgress(mapped);
  }

  return mapped;
}
