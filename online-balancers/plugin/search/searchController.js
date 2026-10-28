import { mediaQuery } from '../routing/mediaContext.js';
import { providerAccountEnvelope } from '../accounts/accountVault.js';
import { castSourcesToArmEntries } from './armCasting.js';

export function sourceId(stream) {
  if (stream?.sourceId) return String(stream.sourceId);
  const id = String(stream?.id || '');
  const separator = id.indexOf(':');
  return separator >= 0 ? id.slice(separator + 1) : id;
}

export function providerId(stream) {
  if (stream?.providerId) return String(stream.providerId);
  return String(stream?.id || '').split(':', 1)[0];
}

export function sourceQuery(stream, context) {
  return mediaQuery({ ...(stream?.query || {}), ...(context || {}) });
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
    async search(query) {
      const normalizedQuery = mediaQuery(query);
      const requests = [];
      if (registry.free.length) requests.push({
        ids: registry.free.map(source => source.id),
        promise: client.search(normalizedQuery, registry.free.map(source => source.id)),
      });
      if (accountVault) {
        for (const source of registry.accounts) {
          const account = await accountVault.getAccount(source.id);
          if (!account) continue;
          requests.push({
            ids: [source.id],
            promise: client.search(
              normalizedQuery,
              [source.id],
              providerAccountEnvelope(source.id, account),
            ),
          });
        }
      }
      const settled = await Promise.allSettled(requests.map(request => request.promise));
      const response = settled.reduce((combined, result, index) => {
        if (result.status === 'fulfilled') {
          combined.items.push(...(result.value.items || []));
          Object.assign(combined.errors, result.value.errors || {});
        } else {
          for (const id of requests[index].ids) {
            combined.errors[id] = result.reason instanceof Error ? result.reason.message : String(result.reason);
          }
        }
        return combined;
      }, { items: [], errors: {} });
      const mappedItems = (response.items || []).map(item => mapSource(item, normalizedQuery));
      const cast = await castSourcesToArmEntries({
        arm,
        context: normalizedQuery,
        sources: mappedItems,
        locale: getLocale?.() || null,
      });
      return {
        items: cast.items,
        unresolvedItems: cast.unresolvedItems,
        errors: response.errors || {},
      };
    },
  });
}
