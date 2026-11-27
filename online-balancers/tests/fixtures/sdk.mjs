const noop = () => {};
const fallbackLogging = { debug: noop, log: noop, info: noop, warn: noop, error: noop };
const sdk = globalThis.PotokSDK ?? {};
sdk.logging ??= fallbackLogging;

export const PotokSDK = sdk;
