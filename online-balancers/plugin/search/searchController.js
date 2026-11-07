import { mediaQuery } from '../routing/mediaContext.js';
import { providerAccountEnvelope } from '../accounts/accountVault.js';
import { castSourcesToArmEntries } from './armCasting.js';

export function sourceId(stream) {
  if (stream?.sourceId) return String(stream.sourceId);
  const id = String(stream?.id || '');
  const separator = id.indexOf(':');
  return separator >= 0 ? id.slice(separator + 1) : '';
}

// Derives the provider slug ONLY from a stream id of the form "{provider}:{sourceId}".
// Episode objects (playlist clicks, episode lists) carry bare ids like "1" — those are NOT provider
// ids, and treating them as such makes the resolver send "Unknown online provider '1'" to the backend.
// Callers fall back to the sourceStream's providerId when this returns ''.
export function providerId(stream) {
  if (stream?.providerId) return String(stream.providerId);
  const id = String(stream?.id || '');
  return id.includes(':') ? id.split(':', 1)[0] : '';
}

export function sourceQuery(stream, context) {
  return mediaQuery({ ...(stream?.query || {}), ...(context || {}) });
}

/**
 * A URL the player can load directly. Plugin-internal handles such as
 * `online-balancers://{provider}/{sourceId}` are identifiers, not playable streams.
 */
export function isPlayableUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

export function mapSource(item, query) {
  return {
    id: `${item.provider}:${item.sourceId}`,
    title: item.title,
    sourceTitle: item.title,
    originalTitle: item.originalTitle,
    year: item.year,
    poster: item.poster,
    quality: item.quality || '720p',
    kind: 'm3u8',
    provider: item.providerName,
    providerId: item.provider,
    sourceId: String(item.sourceId),
    voice: item.voice || '',
    mediaType: item.mediaType || query.type,
    query,
    url: `online-balancers://${item.provider}/${item.sourceId}`,
    streamUrl: `online-balancers://${item.provider}/${item.sourceId}`,
  };
}

export function createSearchService({ client, registry, accountVault = null, arm = null, getLocale = null }) {
  return Object.freeze({
    // Streaming search: ONE request to the backend; every provider result/error arrives
    // as an NDJSON chunk and is forwarded to onProgress immediately (cards and chips
    // render as providers finish). The final return value is unchanged (all items,
    // ARM-cast, plus errors).
    async search(query, onProgress = null) {
      const normalizedQuery = mediaQuery(query);
      const providerIds = registry.free.map(source => source.id);
      const accounts = {};
      if (accountVault) {
        for (const source of registry.accounts) {
          const stored = await accountVault.getAccount(source.id);
          if (!stored) continue;
          providerIds.push(source.id);
          accounts[source.id] = providerAccountEnvelope(source.id, stored);
        }
      }

      const combined = { items: [], errors: {} };
      const handleChunk = (chunk) => {
        if (!onProgress) return;
        if (chunk.type === 'provider' && Array.isArray(chunk.items)) {
          combined.items.push(...chunk.items.map(item => mapSource(item, normalizedQuery)));
        } else if (chunk.type === 'provider-error' && chunk.provider) {
          combined.errors[chunk.provider] = chunk.error || 'error';
        } else {
          return;
        }
        onProgress({ items: combined.items, errors: { ...combined.errors } });
      };

      const finalResponse = await client.search(
        normalizedQuery,
        providerIds,
        handleChunk,
        Object.keys(accounts).length ? accounts : null,
      );

      const mappedItems = (finalResponse.items || []).map(item => mapSource(item, normalizedQuery));
      const cast = await castSourcesToArmEntries({
        arm,
        context: normalizedQuery,
        sources: mappedItems,
        locale: getLocale?.() || null,
      });
      return {
        items: cast.items,
        unresolvedItems: cast.unresolvedItems,
        errors: finalResponse.errors || {},
      };
    },

    // One-provider refresh (soft-error retry). Reuses the same client path with a
    // single-element provider set; account providers need their stored account.
    async searchProvider(query, providerId) {
      const normalizedQuery = mediaQuery(query);
      const source = [...registry.free, ...registry.accounts]
        .find(candidate => candidate.id === providerId);
      if (!source) throw new Error(`Unknown online source '${providerId}'`);

      let account = null;
      if (registry.accounts.some(candidate => candidate.id === providerId)) {
        const stored = await accountVault?.getAccount(providerId);
        if (!stored) return { items: [], error: 'locked', errors: {} };
        account = providerAccountEnvelope(providerId, stored);
      }

      try {
        const value = await client.search(
          normalizedQuery,
          [providerId],
          null,
          account ? { [providerId]: account } : null,
        );
        return {
          items: (value.items || []).map(item => mapSource(item, normalizedQuery)),
          error: null,
          errors: value.errors || {},
        };
      } catch (reason) {
        return { items: [], error: reason instanceof Error ? reason.message : String(reason), errors: {} };
      }
    },
  });
}
