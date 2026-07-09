import { PotokSDK } from 'potok-sdk';
import { resolveSearchEngineUrl, searchEngineHeaders } from './config.js';

function parseCategories(value) {
  if (value === undefined || value === "") return [];
  return String(value)
    .split(/[,\s]+/)
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((num) => !Number.isNaN(num));
}

function authFields(authorization) {
  return {
    login: authorization?.login ?? "",
    password: authorization?.password ?? "",
  };
}

export function fileConfigToSettings(config) {
  const rutrackerAuth = authFields(config.rutracker?.authorization);
  const animelayerAuth = authFields(config.animelayer?.authorization);
  const kinozalAuth = authFields(config.kinozal?.authorization);
  const ffprobeAuth = authFields(config.ffprobe?.authorization);
  const proxyItem = config.proxy?.list?.[0] ?? {};

  return {
    searchEngineApiKey: config.apiKey ?? "",
    mergeDuplicates: config.mergeDuplicates,
    mergeNumDuplicates: config.mergeNumDuplicates,
    cacheEnable: config.cache.enable,
    cacheExpiry: config.cache.expiry,
    cacheAuthExpiry: config.cache.authExpiry,
    refreshEnable: config.refresh.enable,
    refreshTimeout: config.refresh.timeOut,
    refreshOlderThanMin: config.refresh.olderThanMin,
    refreshLimit: config.refresh.limit,
    ffprobeEnable: config.ffprobe.enable,
    ffprobeTimeout: config.ffprobe.timeOut,
    ffprobeTsUri: config.ffprobe.tsUri ?? "",
    ffprobeBatchSize: config.ffprobe.batchSize,
    ffprobeAttempts: config.ffprobe.attempts,
    ffprobeLogin: ffprobeAuth.login,
    ffprobePassword: ffprobeAuth.password,
    proxyBypassOnLocal: config.proxy.bypassOnLocal,
    proxyUrl: proxyItem.url ?? "",
    proxyUsername: proxyItem.username ?? "",
    proxyPassword: proxyItem.password ?? "",
    rutrackerEnableSearch: config.rutracker.enableSearch,
    rutrackerPopularEnable: config.rutracker.popular.enable,
    rutrackerPopularTimeout: config.rutracker.popular.timeOut,
    rutrackerPopularMaxPages: config.rutracker.popular.maxPages,
    rutrackerPopularCategories: config.rutracker.popular.categories.join(", "),
    rutrackerLogin: rutrackerAuth.login,
    rutrackerPassword: rutrackerAuth.password,
    animelayerEnableSearch: config.animelayer.enableSearch,
    animelayerLogin: animelayerAuth.login,
    animelayerPassword: animelayerAuth.password,
    nnmclubEnableSearch: config.nnmclub.enableSearch,
    rutorEnableSearch: config.rutor.enableSearch,
    anilibertyEnableSearch: config.aniliberty.enableSearch,
    kinozalEnableSearch: config.kinozal.enableSearch,
    kinozalLogin: kinozalAuth.login,
    kinozalPassword: kinozalAuth.password,
    megapeerEnableSearch: config.megapeer.enableSearch,
  };
}

export function settingsToFileConfig(settings) {
  const proxyUrl = String(settings.proxyUrl ?? "").trim();
  const apiKey = String(settings.searchEngineApiKey ?? "").trim();

  return {
    apiKey: apiKey || null,
    mergeDuplicates: !!settings.mergeDuplicates,
    mergeNumDuplicates: !!settings.mergeNumDuplicates,
    cache: {
      enable: !!settings.cacheEnable,
      expiry: Number(settings.cacheExpiry ?? 15),
      authExpiry: Number(settings.cacheAuthExpiry ?? 1),
    },
    refresh: {
      enable: !!settings.refreshEnable,
      timeOut: Number(settings.refreshTimeout ?? 1440),
      olderThanMin: Number(settings.refreshOlderThanMin ?? 180),
      limit: Number(settings.refreshLimit ?? 50),
    },
    ffprobe: {
      enable: !!settings.ffprobeEnable,
      timeOut: Number(settings.ffprobeTimeout ?? 60),
      tsUri: String(settings.ffprobeTsUri ?? ""),
      batchSize: Number(settings.ffprobeBatchSize ?? 20),
      attempts: Number(settings.ffprobeAttempts ?? 3),
      authorization: {
        login: String(settings.ffprobeLogin ?? ""),
        password: String(settings.ffprobePassword ?? ""),
      },
    },
    proxy: {
      bypassOnLocal: !!settings.proxyBypassOnLocal,
      list: proxyUrl
        ? [{
            url: proxyUrl,
            username: String(settings.proxyUsername ?? ""),
            password: String(settings.proxyPassword ?? ""),
          }]
        : [],
    },
    rutracker: {
      enableSearch: !!settings.rutrackerEnableSearch,
      authorization: {
        login: String(settings.rutrackerLogin ?? ""),
        password: String(settings.rutrackerPassword ?? ""),
      },
      popular: {
        enable: !!settings.rutrackerPopularEnable,
        timeOut: Number(settings.rutrackerPopularTimeout ?? 600),
        maxPages: Number(settings.rutrackerPopularMaxPages ?? 3),
        categories: parseCategories(settings.rutrackerPopularCategories),
      },
    },
    animelayer: {
      enableSearch: !!settings.animelayerEnableSearch,
      authorization: {
        login: String(settings.animelayerLogin ?? ""),
        password: String(settings.animelayerPassword ?? ""),
      },
    },
    nnmclub: { enableSearch: !!settings.nnmclubEnableSearch },
    rutor: { enableSearch: !!settings.rutorEnableSearch },
    aniliberty: { enableSearch: !!settings.anilibertyEnableSearch },
    kinozal: {
      enableSearch: !!settings.kinozalEnableSearch,
      authorization: {
        login: String(settings.kinozalLogin ?? ""),
        password: String(settings.kinozalPassword ?? ""),
      },
    },
    megapeer: { enableSearch: !!settings.megapeerEnableSearch },
  };
}

async function fetchSearchEngineMeta(baseUrl, headers) {
  const res = await PotokSDK.http.get(`${baseUrl}/api/v1/config/meta`, headers);
  if (res.status !== 200) return null;
  return JSON.parse(res.data);
}

async function fetchSearchEngineConfig(baseUrl, headers) {
  const res = await PotokSDK.http.get(`${baseUrl}/api/v1/config`, headers);
  if (res.status !== 200) return null;
  return JSON.parse(res.data);
}

async function saveSearchEngineConfig(baseUrl, headers, config) {
  const res = await PotokSDK.http.put(
    `${baseUrl}/api/v1/config`,
    config,
    { "Content-Type": "application/json", ...headers },
  );
  return res.status === 200;
}

function lockedNoticeHtml() {
  return PotokSDK.i18n.t("potok-torrents:config.configLockedNotice");
}

export function registerSearchEngineSettings() {
  PotokSDK.onSettingsPageOpened(async () => {
    const baseUrl = await resolveSearchEngineUrl();
    if (!baseUrl) {
      PotokSDK.updateSettingsForm({
        searchEngineConfigLocked: false,
        searchEngineConfigEditable: false,
        configLockedNotice: "",
      });
      return;
    }

    const headers = await searchEngineHeaders();
    const meta = await fetchSearchEngineMeta(baseUrl, headers);
    if (!meta) {
      PotokSDK.updateSettingsForm({
        searchEngineConfigLocked: false,
        searchEngineConfigEditable: false,
        configLockedNotice: "",
      });
      return;
    }

    if (meta.readOnly) {
      PotokSDK.updateSettingsForm({
        searchEngineConfigLocked: true,
        searchEngineConfigEditable: false,
        configLockedNotice: lockedNoticeHtml(),
      });
      return;
    }

    const fileConfig = await fetchSearchEngineConfig(baseUrl, headers);
    const updates = {
      searchEngineConfigLocked: false,
      searchEngineConfigEditable: true,
      configLockedNotice: "",
      ...(fileConfig ? fileConfigToSettings(fileConfig) : {}),
    };
    PotokSDK.updateSettingsForm(updates);
  });

  PotokSDK.onSettingsSaved(async (settings) => {
    if (!settings.searchEngineConfigEditable) return;

    const baseUrl = await resolveSearchEngineUrl();
    if (!baseUrl) {
      throw new Error(PotokSDK.i18n.t("potok-torrents:errors.noSearchUrl"));
    }

    const headers = await searchEngineHeaders();
    const ok = await saveSearchEngineConfig(baseUrl, headers, settingsToFileConfig(settings));
    if (!ok) {
      throw new Error(PotokSDK.i18n.t("potok-torrents:errors.searchEngineConfigSaveFailed"));
    }
  });
}