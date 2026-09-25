export const PotokSDK = {
  config: { torrentGoURL: 'https://torrent.test', searchEngineURL: 'https://search.test' },
  i18n: { t: (key) => key, locale: 'ru' },
  storage: { local: { getItem: async () => null } },
  http: {},
};
