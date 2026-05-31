import { PotokSDK } from 'potok-sdk';

const { VStack, HStack, Text, Badge } = PotokSDK.ui.components;

const statusState = PotokSDK.createState({
  searchEngine: { configured: false, online: false, latency: -1 },
  torrServer: { configured: false, online: false, latency: -1 }
});

function getStatusLabel(info) {
  if (!info.configured) return "выкл";
  if (!info.online || info.latency < 0) return "оффлайн";
  return `${info.latency} ms`;
}

function getStatusBadgeColor(info) {
  if (!info.configured) return "info";
  if (!info.online || info.latency < 0) return "error";
  if (info.latency <= 100) return "success";
  if (info.latency <= 300) return "warning";
  return "error";
}

function buildStatusLayout() {
  return VStack()
    .spacing(8)
    .children([
      HStack()
        .children([
          Badge("").color(getStatusBadgeColor(statusState.searchEngine)),
          Text("Поиск медиа").variant("secondary").size("sm"),
          Text(getStatusLabel(statusState.searchEngine)).variant("hint").size("sm")
        ]),
      HStack()
        .children([
          Badge("").color(getStatusBadgeColor(statusState.torrServer)),
          Text("Торрент-плеер").variant("secondary").size("sm"),
          Text(getStatusLabel(statusState.torrServer)).variant("hint").size("sm")
        ])
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
  let searchUrl = await PotokSDK.storage.local.getItem("searchEngineURL");
  if (searchUrl === null) {
    searchUrl = PotokSDK.config.searchEngineURL || "";
  }

  let torrUrl = await PotokSDK.storage.local.getItem("torrentGoURL");
  if (torrUrl === null) {
    torrUrl = PotokSDK.config.playerServerURL || PotokSDK.config.torrentGoURL || "";
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
