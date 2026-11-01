import { providerId, sourceId, sourceQuery, isPlayableUrl } from '../search/searchController.js';
import { mergeEpisodeVariants, movieEpisode } from './mergeVariants.js';
import { providerAccountEnvelope } from '../accounts/accountVault.js';
import { canonicalizeAnimeEpisodes, resolveAnimeArmLayout } from './armEpisodes.js';

/**
 * Resolve all episodes that are missing a real stream URL.
 * Empty URLs and plugin-internal `online-balancers://` handles both count as unresolved.
 * @param {{ client: any, episodes: any[], accountVault: any, primaryProviderId?: string }} params
 * @returns {Promise<{ episodes: any[], hasUrlResolution: boolean }>}
 */
export async function resolveEpisodeUrls({ client, episodes = [], accountVault = null, primaryProviderId = null }) {
  const toResolve = episodes.filter(ep => !isPlayableUrl(ep.url));
  if (!toResolve.length) return { episodes, hasUrlResolution: false };

  const resolvedEpisodes = new Array(episodes.length).fill(null);
  for (let i = 0; i < episodes.length; i++) {
    resolvedEpisodes[i] = episodes[i];
  }

  const resolutionRequests = toResolve.map(async (ep) => {
    const epProviderId = ep.providerId || primaryProviderId;
    const account = epProviderId && accountVault
      ? await accountVault.getAccount(epProviderId)
      : null;
    const season = ep.season ?? null;
    const episode = typeof ep.episode === 'number' ? ep.episode : Number(ep.episode) || null;

    const response = await client.resolvePlayback({
      provider: epProviderId,
      sourceId: ep.sourceId,
      query: ep.query,
      season,
      episode,
      voice: ep.voice || null,
      ...(account ? { account: providerAccountEnvelope(epProviderId, account) } : {}),
    });

    if (response?.streamUrl) {
      const idx = episodes.indexOf(ep);
      if (idx !== -1) {
        resolvedEpisodes[idx] = { ...resolvedEpisodes[idx], url: response.streamUrl, streamUrl: response.streamUrl };
      }
    }
  });

  await Promise.allSettled(resolutionRequests);

  return { episodes: resolvedEpisodes, hasUrlResolution: true };
}

/**
 * @param {{
 *   client: any,
 *   translate: (key: string, values?: Record<string, unknown>) => string,
 *   accountVault?: any,
 *   arm?: any,
 *   concurrency?: number,
 * }} dependencies
 */
export function createEpisodeService({ client, translate, accountVault = null, arm = null, concurrency = 6 }) {
  async function fetchEpisodes(stream, context) {
    const id = providerId(stream);
    const account = accountVault
      ? await Reflect.apply(Reflect.get(accountVault, 'getAccount'), accountVault, [id])
      : null;
    const response = await client.getEpisodes({
      provider: id,
      sourceId: sourceId(stream),
      query: sourceQuery(stream, context),
      ...(account ? { account: providerAccountEnvelope(id, account) } : {}),
    });
    return {
      episodes: (response.episodes || []).map(item => ({
        id: item.id,
        season: item.season,
        episode: item.number,
        title: item.title || translate('episodes.fallbackTitle', { number: item.number }),
        url: item.url || '',
        voice: item.voice || stream.voice || '',
        provider: stream.provider,
        providerId: providerId(stream),
        sourceId: sourceId(stream),
        quality: stream.quality,
        query: stream.query,
        audios: (item.audios || []).map(audio => ({
          id: audio.id,
          name: audio.name,
          url: audio.url || item.url || '',
          provider: stream.provider,
          providerId: providerId(stream),
          sourceId: sourceId(stream),
          quality: stream.quality,
          query: stream.query,
        })),
      })),
      tmdbSeasonsCount: response.seasonsCount || 1,
    };
  }

  async function fetchGroupedEpisodes(group, context) {
    if (group.mediaType === 'movie') return { episodes: [movieEpisode(group)] };

    const successful = new Array();
    for (let offset = 0; offset < group.variants.length; offset += concurrency) {
      const chunk = group.variants.slice(offset, offset + concurrency);
      const settled = await Promise.allSettled(chunk.map(stream => fetchEpisodes(stream, context)));
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') successful.push({ stream: chunk[index], result: result.value });
      });
    }
    const armLayout = await resolveAnimeArmLayout(arm, context).catch(() => null);

    if (!armLayout) {
      const merged = mergeEpisodeVariants(successful);
      const { episodes: resolvedEpisodes } = await resolveEpisodeUrls({
        client,
        episodes: merged,
        accountVault,
        primaryProviderId: successful[0]?.stream?.providerId || null,
      });
      return { episodes: resolvedEpisodes, arm: null };
    }

    const canonicalized = successful.map(({ stream, result }) => {
      const mapped = canonicalizeAnimeEpisodes(result.episodes, armLayout);
      return { stream, result, mapped };
    });
    const unresolvedEpisodes = canonicalized.flatMap(({ stream, mapped }) =>
      mapped.unresolved.map(episode => ({ stream, episode })));
    const canonical = canonicalized
      .filter(({ mapped }) => mapped.episodes.length > 0)
      .map(({ stream, result, mapped }) => ({
        stream,
        result: { ...result, episodes: mapped.episodes },
      }));

    const merged = mergeEpisodeVariants(canonical);
    const { episodes: resolvedEpisodes } = await resolveEpisodeUrls({
      client,
      episodes: merged,
      accountVault,
      primaryProviderId: canonical[0]?.stream?.providerId || null,
    });

    return {
      episodes: resolvedEpisodes,
      unresolvedEpisodes,
      arm: {
        state: 'resolved',
        workId: armLayout.workId,
        graphVersion: armLayout.graphVersion,
      },
    };
  }

  return Object.freeze({ fetchEpisodes, fetchGroupedEpisodes });
}
