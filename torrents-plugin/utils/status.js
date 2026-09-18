import { PotokSDK } from 'potok-sdk';
import { resolveTorrUrl } from './config.js';

const { VStack, StatusRow } = PotokSDK.ui.components;

const FAIL_THRESHOLD = 3;
const LATENCY_JITTER_MS = 20;
const HEALTH_TIMEOUT_MS = 20000;

const statusState = PotokSDK.createState({
  searchEngine: { configured: false, online: false, latency: -1 },
  torrServer: { configured: false, online: false, latency: -1 }
});

const failCounts = { searchEngine: 0, torrServer: 0 };
let pingTimerStarted = false;

function getStatusLabel(info) {
  if (!info.configured) return PotokSDK.i18n.t("potok-torrents:status.off");
  if (!info.online || info.latency < 0) return PotokSDK.i18n.t("potok-torrents:status.offline");
  return `${info.latency} ms`;
}

function getStatusColor(info) {
  if (!info.configured) return "offline";
  if (!info.online || info.latency < 0) return "error";
  if (info.latency <= 400) return "success";
  return "warning";
}

function buildStatusLayout() {
  return VStack()
    .spacing(8)
    .children([
      StatusRow(PotokSDK.i18n.t("potok-torrents:status.mediaSearch"))
        .status(getStatusColor(statusState.searchEngine))
        .value(getStatusLabel(statusState.searchEngine)),
      StatusRow(PotokSDK.i18n.t("potok-torrents:status.torrentPlayer"))
        .status(getStatusColor(statusState.torrServer))
        .value(getStatusLabel(statusState.torrServer))
    ]);
}

function statusesEqual(prev, next) {
  if (prev.configured !== next.configured || prev.online !== next.online) return false;
  if (getStatusColor(prev) !== getStatusColor(next)) return false;
  return Math.abs(prev.latency - next.latency) <= LATENCY_JITTER_MS;
}

function commitStatus(key, next) {
  if (statusesEqual(statusState[key], next)) return;
  statusState[key] = next;
}

function applyPing(key, ping) {
  if (!ping.configured) {
    failCounts[key] = 0;
    commitStatus(key, ping);
    return;
  }
  if (ping.online) {
    failCounts[key] = 0;
    commitStatus(key, ping);
    return;
  }
  failCounts[key] += 1;
  if (failCounts[key] < FAIL_THRESHOLD) {
    const prev = statusState[key];
    if (prev.online && prev.latency >= 0) {
      commitStatus(key, { configured: true, online: true, latency: prev.latency });
    }
    return;
  }
  commitStatus(key, ping);
}

async function pingService(baseUrl, path = "/health") {
  if (!baseUrl) return { configured: false, online: false, latency: -1 };
  let url = baseUrl.trim();
  if (!url) return { configured: false, online: false, latency: -1 };
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  if (url.endsWith("/")) {
    url = url.slice(0, -1);
  }
  url = `${url}${path}`;

  const startTime = Date.now();
  try {
    const res = await PotokSDK.http.get(url, undefined, HEALTH_TIMEOUT_MS);
    const latency = Date.now() - startTime;
    if (res.status >= 200 && res.status < 400) {
      return { configured: true, online: true, latency };
    }
    return { configured: true, online: false, latency: -1 };
  } catch (err) {
    return { configured: true, online: false, latency: -1 };
  }
}

async function checkPings() {
  let searchUrl = PotokSDK.config.searchEngineURL || "";
  if (!searchUrl) {
    searchUrl = await PotokSDK.storage.local.getItem("searchEngineURL") || "";
  }

  const torrUrl = await resolveTorrUrl();

  const [searchRes, torrRes] = await Promise.all([
    pingService(searchUrl, "/health"),
    pingService(torrUrl, "/health")
  ]);

  applyPing("searchEngine", searchRes);
  applyPing("torrServer", torrRes);
}

export function registerSidebarStatus() {
  PotokSDK.registerSlotContribution({
    slotName: "sidebar-status",
    id: "torrents-sidebar-status",
    render: () => {
      return {
        label: PotokSDK.i18n.t("potok-torrents:manifest.statusTitle"),
        layout: buildStatusLayout()
      };
    }
  });

  if (!pingTimerStarted) {
    pingTimerStarted = true;
    statusState.$subscribe(() => {
      PotokSDK.ui.render(buildStatusLayout(), "torrents-sidebar-status");
    });
    setInterval(checkPings, 30000);
  }

  checkPings();
}
