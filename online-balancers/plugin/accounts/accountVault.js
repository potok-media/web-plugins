const STORAGE_KEY = 'provider-accounts';
const STORAGE_VERSION = 1;
const FORBIDDEN_PERSISTED_FIELDS = /pass(word)?|loginPassword/i;
const KINOPUB_PROVIDER_ID = 'kinopub';
const DEFAULT_REFRESH_SKEW_MS = 60_000;
const REFRESH_FAILURE_BACKOFF_MS = 30_000;

function clone(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function emptyDocument() {
  return { version: STORAGE_VERSION, accounts: {} };
}

function normalizeDocument(value) {
  if (!value || value.version !== STORAGE_VERSION || typeof value.accounts !== 'object') {
    return emptyDocument();
  }
  return {
    version: STORAGE_VERSION,
    accounts: Object.fromEntries(Object.entries(value.accounts)
      .filter(([providerId, account]) => providerId && account && typeof account === 'object')),
  };
}

function normalizeAccount(account) {
  if (!account || typeof account !== 'object' || Array.isArray(account)) {
    throw new Error('Provider account must be an object');
  }
  const entries = Object.entries(account).filter(([, value]) => value != null && value !== '');
  if (entries.some(([key]) => FORBIDDEN_PERSISTED_FIELDS.test(key))) {
    throw new Error('Passwords must never be persisted');
  }
  if (entries.length > 16 || entries.some(([key, value]) => key.length > 64 || String(value).length > 16_384)) {
    throw new Error('Provider account is too large');
  }
  return Object.fromEntries(entries.map(([key, value]) => [key, String(value)]));
}

export function createAccountVault(storage, {
  refreshAccount = null,
  now = () => Date.now(),
  refreshSkewMs = DEFAULT_REFRESH_SKEW_MS,
} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new Error('Persistent plugin storage is unavailable');
  }
  const pendingRefreshes = new Map();
  const refreshBlockedUntil = new Map();

  async function readDocument() {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return emptyDocument();
    try {
      return normalizeDocument(JSON.parse(raw));
    } catch {
      return emptyDocument();
    }
  }

  async function writeDocument(document) {
    await storage.setItem(STORAGE_KEY, JSON.stringify(normalizeDocument(document)));
  }

  async function readAccount(providerId) {
    const account = (await readDocument()).accounts[String(providerId || '')];
    return account ? clone(account) : null;
  }

  function shouldRefresh(providerId, account) {
    if (providerId !== KINOPUB_PROVIDER_ID || typeof refreshAccount !== 'function') return false;
    if (!account?.refreshToken || !account?.expiresAt) return false;
    if ((refreshBlockedUntil.get(providerId) ?? 0) > now()) return false;
    const expiresAt = Number(account.expiresAt);
    return Number.isFinite(expiresAt) && now() + refreshSkewMs >= expiresAt;
  }

  async function refresh(providerId, account) {
    if (pendingRefreshes.has(providerId)) return pendingRefreshes.get(providerId);
    const operation = (async () => {
      const refreshed = normalizeAccount({
        ...account,
        ...await refreshAccount(providerId, clone(account)),
      });
      const document = await readDocument();
      const current = document.accounts[providerId];
      if (!current) return null;
      if (current.refreshToken !== account.refreshToken) return clone(current);
      document.accounts[providerId] = refreshed;
      await writeDocument(document);
      refreshBlockedUntil.delete(providerId);
      return clone(refreshed);
    })();
    pendingRefreshes.set(providerId, operation);
    try {
      return await operation;
    } finally {
      pendingRefreshes.delete(providerId);
    }
  }

  return Object.freeze({
    async loadAccounts() {
      return clone((await readDocument()).accounts);
    },
    async getAccount(providerId) {
      const id = String(providerId || '');
      const account = await readAccount(id);
      if (!shouldRefresh(id, account)) return account;
      try {
        return await refresh(id, account);
      } catch {
        // Keep the existing access token for the request. If it is no longer valid, the
        // provider returns an explicit authorization error while the other providers keep
        // working; a transient refresh failure is retried on a later request.
        refreshBlockedUntil.set(id, now() + REFRESH_FAILURE_BACKOFF_MS);
        return account;
      }
    },
    async saveAccount(providerId, account) {
      const id = String(providerId || '').trim();
      if (!id) throw new Error('Provider id is required');
      const document = await readDocument();
      document.accounts[id] = normalizeAccount(account);
      await writeDocument(document);
      return clone(document.accounts[id]);
    },
    async removeAccount(providerId) {
      const document = await readDocument();
      delete document.accounts[String(providerId || '')];
      await writeDocument(document);
    },
  });
}

export function providerAccountEnvelope(providerId, account) {
  return account ? { provider: providerId, values: clone(account) } : null;
}
