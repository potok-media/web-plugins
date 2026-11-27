function component() {
  const builder = new Proxy({ compile: () => ({}) }, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === 'then') return undefined;
      return () => builder;
    },
  });
  return builder;
}

export const registrations = { streams: [], slots: [] };

export const PotokSDK = {
  runtime: { context: { config: { torrentGoURL: 'https://torrent.test', searchEngineURL: 'https://search.test' } } },
  i18n: { t: (key) => key, language: 'ru', registerTranslations() {} },
  storage: { local: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } },
  http: {
    request: async ({ url }) => { throw new Error(`Unexpected request ${url}`); },
    stream: async ({ url }) => { throw new Error(`Unexpected stream ${url}`); },
  },
  logging: { debug() {}, log() {}, info() {}, warn() {}, error() {} },
  streams: { registerStreamSource: (source) => registrations.streams.push(source) },
  registerSlotContribution: (slot) => registrations.slots.push(slot),
  ui: {
    components: new Proxy({}, { get: () => component }),
    showHUD() {},
    playVideo() {},
    render() {},
    navigateTo() {},
    injectHostCss() {},
  },
};
