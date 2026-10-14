import { PotokSDK } from 'potok-sdk';
import { getEpisodes } from './episodes.js';
import { getPlaybackInfo } from './playback.js';
import { parseJson } from '../utils/http.js';
import { resolveSearchEngineUrl } from '../utils/config.js';
import { canonicalId, normalizeCursor, titleKey, toApiBody } from '../utils/continueCursor.js';
export { titleKey } from '../utils/continueCursor.js';

export const CONTINUE_KEY = "continueWatching";
const PLUGIN_ID = "potok-torrents";
const MAX_ITEMS = 8;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const { ContinueWatchingRow } = PotokSDK.ui.components;

const continueState = PotokSDK.createState({ items: [] });

export function formatTimecode(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function loadLedger() {
  try {
    const raw = PotokSDK.storage.local.getItem(CONTINUE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveLedger(ledger) {
  return PotokSDK.storage.local.setItem(CONTINUE_KEY, JSON.stringify(ledger));
}

async function continueApi(path, { method = "GET", body } = {}) {
  const base = await resolveSearchEngineUrl();
  if (!base) return null;
  const url = `${base}/api/v1/torrents/continue${path || ""}`;
  try {
    const res = method === "POST"
      ? await PotokSDK.http.post(url, body)
      : await PotokSDK.http.get(url);
    if (res.status < 200 || res.status >= 300) return null;
    return parseJson(res);
  } catch {
    return null;
  }
}

function persistNow(key) {
  const cursor = loadLedger()[key];
  if (cursor) continueApi("", { method: "POST", body: toApiBody(cursor) });
}

export async function hydrateFromSearchEngine() {
  const data = await continueApi("");
  const items = (data && (data.items || data.Items)) || [];
  const ledger = {};
  const merge = (raw) => {
    const cursor = normalizeCursor(raw);
    if (!cursor?.fileIndex) return;
    const current = ledger[cursor.workId];
    if (!current || current.updatedAt < cursor.updatedAt) ledger[cursor.workId] = cursor;
  };
  // Old TMDB-only records are discarded. Playback uses ARM identities from now on.
  Object.values(loadLedger()).forEach(merge);
  if (Array.isArray(items)) items.forEach(merge);
  saveLedger(ledger);
}

export function listContinueCursors() {
  const now = Date.now();
  return Object.values(loadLedger()).map(normalizeCursor)
    .filter((c) => c && c.stream && now - (c.updatedAt || 0) < MAX_AGE_MS)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_ITEMS);
}

export function applyProgressPayload(payload) {
  if (!payload) return;
  if (payload.providerId && payload.providerId !== PLUGIN_ID) return;
  if (!payload.streamHash || payload.fileIndex == null || payload.fileIndex === "") return;
  const workId = canonicalId(payload.workId);
  if (!workId) return;
  const mediaType = payload.mediaType === "movie" ? "movie" : "tv";
  const key = titleKey(workId);
  const ledger = loadLedger();
  if (payload.isCompleted) {
    delete ledger[key];
    saveLedger(ledger);
    continueApi("/remove", { method: "POST", body: { workId } });
    return;
  }
  const src = payload.sourceStream && typeof payload.sourceStream === "object" ? payload.sourceStream : {};
  const stream = {
    ...src,
    title: src.title || payload.title || "",
    hash: payload.streamHash,
    workId,
    episodeId: canonicalId(payload.episodeId),
    entryId: canonicalId(payload.entryId),
  };
  const prev = ledger[key];
  const sameEpisode = prev && prev.stream?.hash === payload.streamHash
    && String(prev.fileIndex) === String(payload.fileIndex)
    && prev.episodeId === canonicalId(payload.episodeId);
  const stillSrc = payload.stillSrc || (sameEpisode ? prev.stillSrc : undefined);
  ledger[key] = {
    mediaType,
    workId,
    episodeId: canonicalId(payload.episodeId),
    entryId: canonicalId(payload.entryId),
    title: (payload.title || stream.title || "").replace(/\s+-\s+S\d+E\d+.*$/, "") || stream.title,
    posterSrc: payload.posterSrc,
    backdropSrc: payload.backdropSrc,
    stillSrc,
    stream,
    fileIndex: String(payload.fileIndex),
    season: payload.season,
    episode: payload.episode,
    progressSeconds: Number(payload.progressSeconds) || 0,
    durationSeconds: Number(payload.durationSeconds) || 0,
    audioName: payload.voice,
    updatedAt: Date.now(),
  };
  const ordered = Object.keys(ledger).filter((key) => normalizeCursor(ledger[key])).sort(
    (a, b) => (ledger[b].updatedAt || 0) - (ledger[a].updatedAt || 0),
  );
  for (const extra of ordered.slice(MAX_ITEMS)) delete ledger[extra];
  saveLedger(ledger);
  persistNow(key);
}

export function toContentItem(cursor) {
  const progress = cursor.durationSeconds > 0
    ? Math.min(1, cursor.progressSeconds / cursor.durationSeconds)
    : 0;
  const time = formatTimecode(cursor.progressSeconds);
  const total = cursor.durationSeconds > 0 ? formatTimecode(cursor.durationSeconds) : "";
  const label = total ? `${time} / ${total}` : time;
  return {
    id: cursor.workId,
    title: cursor.title,
    subtitle: label,
    image: cursor.mediaType !== "movie" && cursor.stillSrc ? cursor.stillSrc : cursor.posterSrc,
    wideImage: cursor.mediaType !== "movie" && cursor.stillSrc
      ? cursor.stillSrc
      : (cursor.backdropSrc || cursor.posterSrc),
    progress,
    mediaType: cursor.mediaType,
    lastSeason: cursor.season,
    lastEpisode: cursor.episode,
    progressLabel: label,
  };
}

function refreshContinueItems() {
  continueState.items = listContinueCursors().map(toContentItem);
}

export async function continueWatching(cursor) {
  const t = (k) => PotokSDK.i18n.t(`potok-torrents:${k}`);
  PotokSDK.ui.showHUD("info", t("home.loadingContinue"));
  const context = { type: cursor.mediaType, workId: cursor.workId, entryId: cursor.entryId,
    episodeId: cursor.episodeId, title: cursor.title };
  const res = await getEpisodes(cursor.stream, context);
  const episodes = res.episodes || [];
  if (!episodes.length) throw new Error(t("errors.noMediaFiles"));
  const sameTorrent = !res.hash || res.hash === cursor.stream.hash;
  let start = sameTorrent ? episodes.find((e) => String(e.id) === String(cursor.fileIndex)) : undefined;
  if (!start && cursor.episodeId) start = episodes.find((e) => e.episodeId === cursor.episodeId);
  if (!start && cursor.season != null) {
    start = episodes.find((e) => e.season === cursor.season && e.episode === cursor.episode);
  }
  if (!start) start = episodes[0];
  const sameFile = sameTorrent && String(start.id) === String(cursor.fileIndex);
  const info = await getPlaybackInfo(cursor.stream, start, context);
  const playlist = episodes.map((ep) => ({
    id: ep.id,
    workId: ep.workId,
    episodeId: ep.episodeId,
    episodeIds: ep.episodeIds,
    entryId: ep.entryId,
    targets: ep.targets,
    progressId: ep.progressId,
    season: ep.season,
    episode: ep.episode,
    title: ep.title,
    streamUrl: ep.url || "",
    streamType: "m3u8",
  }));
  PotokSDK.ui.playVideo({
    ...info,
    providerId: PLUGIN_ID,
    startAt: sameFile ? cursor.progressSeconds : 0,
    voice: cursor.audioName,
    posterSrc: cursor.posterSrc,
    backdropSrc: cursor.backdropSrc,
    stillSrc: cursor.stillSrc,
    playlist,
    playlistIndex: Math.max(0, episodes.indexOf(start)),
    sourceStream: cursor.stream,
  });
}

function buildHomeLayout() {
  return ContinueWatchingRow()
    .title(PotokSDK.i18n.t("potok-torrents:home.continueWatching"))
    .items(continueState.items)
    .onCardClick((item) => {
      const cursor = listContinueCursors().find(
        (c) => c.workId === item.id,
      );
      if (!cursor) return;
      continueWatching(cursor).catch((err) => {
        PotokSDK.ui.showHUD("error", err instanceof Error ? err.message : String(err));
      });
    });
}

export function registerContinueWatching() {
  refreshContinueItems();
  hydrateFromSearchEngine().then(() => refreshContinueItems());
  PotokSDK.registerHomeSection({
    id: "torrents-continue-watching",
    position: "top",
    render() {
      return {
        label: PotokSDK.i18n.t("potok-torrents:home.continueWatching"),
        layout: buildHomeLayout(),
      };
    },
  });
  continueState.$subscribe(() => {
    PotokSDK.ui.render(buildHomeLayout(), "torrents-continue-watching");
  });
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.source !== "potok-host" || msg.action !== "PLAYBACK_PROGRESS") return;
    applyProgressPayload(msg.payload);
    refreshContinueItems();
  });
}
