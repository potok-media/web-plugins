import { PotokSDK } from 'potok-sdk';
import { getEpisodes } from './episodes.js';
import { getPlaybackInfo } from './playback.js';
import { parseJson } from '../utils/http.js';
import { resolveSearchEngineUrl } from '../utils/config.js';

export const CONTINUE_KEY = "continueWatching";
const PLUGIN_ID = "potok-torrents";
const MAX_ITEMS = 8;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const { ContinueWatchingRow } = PotokSDK.ui.components;

const continueState = PotokSDK.createState({ items: [] });

export function titleKey(mediaType, tmdbId) {
  return `${mediaType}:${tmdbId}`;
}

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

function normalizeCursor(raw) {
  if (!raw || typeof raw !== "object") return null;
  const tmdbId = Number(raw.tmdbId ?? raw.TmdbId);
  if (!tmdbId) return null;
  const stream = raw.stream || raw.Stream || {};
  let updatedAt = raw.updatedAt ?? raw.UpdatedAt;
  if (typeof updatedAt === "string") updatedAt = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAt)) updatedAt = Date.now();
  const mediaType = (raw.mediaType || raw.MediaType) === "movie" ? "movie" : "tv";
  const hash = (raw.infoHash || raw.InfoHash || stream.hash || "").toLowerCase();
  return {
    mediaType,
    tmdbId,
    title: raw.title || raw.Title || stream.title || "",
    posterSrc: raw.posterSrc || raw.PosterSrc,
    backdropSrc: raw.backdropSrc || raw.BackdropSrc,
    stream: { ...stream, title: stream.title || raw.title || "", hash: hash || stream.hash },
    fileIndex: String(raw.fileIndex ?? raw.FileIndex ?? ""),
    season: raw.season ?? raw.Season,
    episode: raw.episode ?? raw.Episode,
    progressSeconds: Number(raw.progressSeconds ?? raw.ProgressSeconds) || 0,
    durationSeconds: Number(raw.durationSeconds ?? raw.DurationSeconds) || 0,
    audioName: raw.audioName || raw.AudioName,
    updatedAt,
  };
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

function toApiBody(cursor) {
  return {
    mediaType: cursor.mediaType,
    tmdbId: cursor.tmdbId,
    title: cursor.title,
    fileIndex: cursor.fileIndex,
    progressSeconds: cursor.progressSeconds,
    durationSeconds: cursor.durationSeconds,
    posterSrc: cursor.posterSrc,
    backdropSrc: cursor.backdropSrc,
    season: cursor.season,
    episode: cursor.episode,
    audioName: cursor.audioName,
    infoHash: cursor.stream?.hash,
    stream: cursor.stream,
  };
}

let persistTimer = null;
let persistKey = null;

function schedulePersist(key) {
  persistKey = key;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const keyNow = persistKey;
    persistKey = null;
    const cursor = keyNow ? loadLedger()[keyNow] : null;
    if (cursor) continueApi("", { method: "POST", body: toApiBody(cursor) });
  }, 4000);
}

async function hydrateFromSearchEngine() {
  const data = await continueApi("");
  const items = (data && (data.items || data.Items)) || [];
  if (!Array.isArray(items) || items.length === 0) return;
  const ledger = loadLedger();
  for (const raw of items) {
    const cursor = normalizeCursor(raw);
    if (!cursor || !cursor.fileIndex) continue;
    ledger[titleKey(cursor.mediaType, cursor.tmdbId)] = cursor;
  }
  saveLedger(ledger);
}

export function listContinueCursors() {
  const now = Date.now();
  return Object.values(loadLedger())
    .filter((c) => c && c.stream && now - (c.updatedAt || 0) < MAX_AGE_MS)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_ITEMS);
}

export function applyProgressPayload(payload) {
  if (!payload) return;
  if (payload.providerId && payload.providerId !== PLUGIN_ID) return;
  if (!payload.streamHash || payload.fileIndex == null || payload.fileIndex === "") return;
  const tmdbId = Number(payload.id);
  if (!tmdbId) return;
  const mediaType = payload.mediaType === "movie" ? "movie" : "tv";
  const key = titleKey(mediaType, tmdbId);
  const ledger = loadLedger();
  if (payload.isCompleted) {
    delete ledger[key];
    saveLedger(ledger);
    continueApi("/remove", { method: "POST", body: { mediaType, tmdbId } });
    return;
  }
  const src = payload.sourceStream && typeof payload.sourceStream === "object" ? payload.sourceStream : {};
  const stream = {
    ...src,
    title: src.title || payload.title || "",
    hash: payload.streamHash,
  };
  ledger[key] = {
    mediaType,
    tmdbId,
    title: (payload.title || stream.title || "").replace(/\s+-\s+S\d+E\d+.*$/, "") || stream.title,
    posterSrc: payload.posterSrc,
    backdropSrc: payload.backdropSrc,
    stream,
    fileIndex: String(payload.fileIndex),
    season: payload.season,
    episode: payload.episode,
    progressSeconds: Number(payload.progressSeconds) || 0,
    durationSeconds: Number(payload.durationSeconds) || 0,
    audioName: payload.voice,
    updatedAt: Date.now(),
  };
  const ordered = Object.keys(ledger).sort(
    (a, b) => (ledger[b].updatedAt || 0) - (ledger[a].updatedAt || 0),
  );
  for (const extra of ordered.slice(MAX_ITEMS)) delete ledger[extra];
  saveLedger(ledger);
  schedulePersist(key);
}

export function toContentItem(cursor) {
  const progress = cursor.durationSeconds > 0
    ? Math.min(1, cursor.progressSeconds / cursor.durationSeconds)
    : 0;
  const time = formatTimecode(cursor.progressSeconds);
  const total = cursor.durationSeconds > 0 ? formatTimecode(cursor.durationSeconds) : "";
  const label = total ? `${time} / ${total}` : time;
  return {
    id: cursor.tmdbId,
    title: cursor.title,
    subtitle: label,
    image: cursor.posterSrc,
    wideImage: cursor.backdropSrc || cursor.posterSrc,
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
  const context = { type: cursor.mediaType, tmdbId: cursor.tmdbId, title: cursor.title };
  const res = await getEpisodes(cursor.stream, context);
  const episodes = res.episodes || [];
  if (!episodes.length) throw new Error(t("errors.noMediaFiles"));
  let start = episodes.find((e) => String(e.id) === String(cursor.fileIndex));
  if (!start && cursor.season != null) {
    start = episodes.find((e) => e.season === cursor.season && e.episode === cursor.episode);
  }
  if (!start) start = episodes[0];
  const sameFile = String(start.id) === String(cursor.fileIndex);
  const info = await getPlaybackInfo(cursor.stream, start, context);
  const playlist = episodes.map((ep) => ({
    id: ep.id,
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
        (c) => c.mediaType === (item.mediaType || "tv") && Number(item.id) === c.tmdbId,
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
