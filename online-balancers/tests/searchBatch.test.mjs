import assert from 'node:assert/strict';
import test from 'node:test';

// Streaming search: ONE backend request; every provider result/error arrives as an
// NDJSON chunk and is forwarded to onProgress immediately. The final return value is
// unchanged (all items, ARM-cast, plus errors).
test('search service streams provider chunks in order and keeps the final contract', async () => {
  const { createSearchService } = await import('../plugin/search/searchController.js');

  const batches = [];
  const client = {
    search: async (query, providers, onEvent, accounts) => {
      batches.push({ providers: [...providers], accounts });
      // Simulate the backend NDJSON stream — chunks in completion order.
      onEvent?.({ type: 'provider', provider: 'kodik', items: [{ provider: 'kodik', providerName: 'Kodik', sourceId: '1', title: 'A', quality: '720p' }] });
      onEvent?.({ type: 'provider', provider: 'alloha', items: [{ provider: 'alloha', providerName: 'Alloha', sourceId: '2', title: 'A', quality: '1080p' }] });
      onEvent?.({ type: 'provider', provider: 'animego', items: [] });
      onEvent?.({ type: 'provider-error', provider: 'anidub', error: 'Search timed out after 8 s.' });
      return {
        items: [
          { provider: 'kodik', providerName: 'Kodik', sourceId: '1', title: 'A', quality: '720p' },
          { provider: 'alloha', providerName: 'Alloha', sourceId: '2', title: 'A', quality: '1080p' },
        ],
        errors: { anidub: 'Search timed out after 8 s.' },
      };
    },
  };
  const registry = {
    free: [
      { id: 'kodik', access: 'free', slow: false },
      { id: 'anidub', access: 'free', slow: true },
      { id: 'animego', access: 'free', slow: true },
    ],
    accounts: [{ id: 'alloha', access: 'account' }, { id: 'rezka', access: 'account' }],
  };
  const accountVault = { async getAccount(id) { return id === 'alloha' ? { token: 'x' } : null; } };
  const service = createSearchService({ client, registry, accountVault, arm: null });

  const progress = [];
  const result = await service.search({ title: 'A' }, event => progress.push({
    providers: event.items.map(item => item.providerId),
    errors: { ...event.errors },
    providerId: event.providerId,
    providerStatus: event.providerStatus,
  }));

  // One request: every free provider plus the connected account providers, with the
  // per-provider account envelopes.
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].providers, ['kodik', 'anidub', 'animego', 'alloha']);
  assert.deepEqual(Object.keys(batches[0].accounts), ['alloha']);
  assert.equal(batches[0].accounts.alloha.provider, 'alloha');

  // Chunks stream in arrival order: kodik, alloha, then the anidub error.
  assert.deepEqual(progress.map(event => event.providers), [
    ['kodik'],
    ['kodik', 'alloha'],
    ['kodik', 'alloha'],
    ['kodik', 'alloha'],
  ]);
  assert.deepEqual(progress.map(event => [event.providerId, event.providerStatus]), [
    ['kodik', 'ok'],
    ['alloha', 'ok'],
    ['animego', 'empty'],
    ['anidub', 'error'],
  ]);
  assert.deepEqual(progress[3].errors, { anidub: 'Search timed out after 8 s.' });

  // Without an ARM the cast keeps everything unresolved; the error rides the final
  // response; locked (account-less) providers never enter the request set.
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.unresolvedItems.map(item => item.providerId).sort(), ['alloha', 'kodik']);
  assert.deepEqual(result.errors, { anidub: 'Search timed out after 8 s.' });
});

test('mapSource preserves a RUTUBE upload title without inventing a quality', async () => {
  const { mapSource } = await import('../plugin/search/searchController.js');
  const stream = mapSource({
    provider: 'rutubemovie',
    providerName: 'RUTUBE',
    sourceId: 'movie-1',
    title: 'Одиссея | The Odyssey (2026, 4K)',
    quality: 'Auto',
  }, { title: 'Одиссея', type: 'movie' });

  assert.equal(stream.title, 'Одиссея');
  assert.equal(stream.sourceTitle, 'Одиссея | The Odyssey (2026, 4K)');
  assert.equal(stream.quality, '');
});

test('searchProvider retries a single provider through the account vault', async () => {
  const { createSearchService } = await import('../plugin/search/searchController.js');

  const calls = [];
  const client = {
    search: async (query, providers, onEvent, accounts) => {
      calls.push({ providers: [...providers], accounts });
      return {
        items: [{ provider: providers[0], providerName: providers[0], sourceId: '9', title: 'A', quality: '480p' }],
        errors: {},
      };
    },
  };
  const registry = {
    free: [{ id: 'kodik', access: 'free', slow: false }],
    accounts: [{ id: 'alloha', access: 'account' }],
  };
  const accountVault = { async getAccount() { return { token: 'x' }; } };
  const service = createSearchService({ client, registry, accountVault, arm: null });

  const retried = await service.searchProvider({ title: 'A' }, 'alloha');
  assert.equal(retried.error, null);
  assert.equal(retried.items[0].providerId, 'alloha');
  assert.deepEqual(calls[0].providers, ['alloha']);
  assert.equal(calls[0].accounts.alloha.provider, 'alloha');

  const noAccount = createSearchService({
    client, registry, accountVault: { async getAccount() { return null; } }, arm: null,
  });
  const lockedResult = await noAccount.searchProvider({ title: 'A' }, 'alloha');
  assert.equal(lockedResult.error, 'locked');
  assert.deepEqual(lockedResult.items, []);
});
