export const PotokSDK = {
  config: {},
  i18n: { t: (key) => key, locale: 'ru-RU' },
  storage: {
    local: {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    },
  },
  http: {},
  ui: {
    components: {},
    showHUD: () => {},
    navigateTo: () => {},
  },
  createState: (initial) => ({ ...initial }),
  arm: {},
};
