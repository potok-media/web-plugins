import { PotokSDK } from 'potok-sdk';

const { VStack, StatusRow } = PotokSDK.ui.components;

const statusState = PotokSDK.createState({
  searchEngine: { configured: false, online: false, latency: -1 },
  torrServer: { configured: false, online: false, latency: -1 }
});

function getStatusLabel(info) {
  if (!info.configured) return "выкл";
  if (!info.online || info.latency < 0) return "оффлайн";
  return `${info.latency} ms`;
}

function getStatusColor(info) {
  if (!info.configured) return "offline";
  if (!info.online || info.latency < 0) return "error";
  if (info.latency <= 100) return "success";
  if (info.latency <= 300) return "warning";
  return "error";
}

function buildStatusLayout() {
  return VStack()
    .spacing(8)
    .children([
      StatusRow("Поиск медиа")
        .status(getStatusColor(statusState.searchEngine))
        .value(getStatusLabel(statusState.searchEngine)),
      StatusRow("Торрент-плеер")
        .status(getStatusColor(statusState.torrServer))
        .value(getStatusLabel(statusState.torrServer))
    ]);
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
    const res = await PotokSDK.http.get(url);
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

  const cleanTorrentGo = (PotokSDK.config.torrentGoURL || "").trim().replace(/\/$/, "");
  let torrUrl = "";
  if (cleanTorrentGo && cleanTorrentGo !== "https://torrent.potok.rip") {
    torrUrl = PotokSDK.config.torrentGoURL;
  } else {
    torrUrl = PotokSDK.config.playerServerURL || PotokSDK.config.torrentGoURL || "";
  }
  if (!torrUrl) {
    torrUrl = await PotokSDK.storage.local.getItem("torrentGoURL") || "";
  }

  const [searchRes, torrRes] = await Promise.all([
    pingService(searchUrl, "/health"),
    pingService(torrUrl, "/health")
  ]);

  statusState.searchEngine = searchRes;
  statusState.torrServer = torrRes;
}

export function registerSidebarStatus() {
  PotokSDK.registerSlotContribution({
    slotName: "sidebar-status",
    id: "torrents-sidebar-status",
    render: () => {
      return {
        label: "Статус Торрентов",
        layout: buildStatusLayout()
      };
    }
  });

  statusState.$subscribe(() => {
    PotokSDK.ui.render(buildStatusLayout(), "torrents-sidebar-status");
  });

  checkPings();
  setInterval(checkPings, 30000);
}
