import { LOCATOR_PREFIX } from '../constants.js';
import { providerId, sourceId, sourceQuery } from '../search/searchController.js';
import { mergeEpisodeVariants, movieEpisode } from './mergeVariants.js';
import { providerAccountEnvelope } from '../accounts/accountVault.js';
import { canonicalizeAnimeEpisodes, resolveAnimeArmLayout } from './armEpisodes.js';

export function episodeUrl(locator) {
  return `${LOCATOR_PREFIX}${locator}`;
}

export function episodeLocator(episode) {
  if (episode?.locator) return episode.locator;
  const url = String(episode?.url || '');
  return url.startsWith(LOCATOR_PREFIX) ? url.slice(LOCATOR_PREFIX.length) : null;
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
        url: episodeUrl(item.locator),
        locator: item.locator,
        voice: item.voice || stream.voice || '',
        provider: stream.provider,
        providerId: providerId(stream),
        sourceId: sourceId(stream),
        quality: stream.quality,
        query: stream.query,
        audios: (item.audios || []).map(audio => ({
          id: audio.id,
          name: audio.name,
          url: audio.url || episodeUrl(audio.locator || item.locator),
          locator: audio.locator || item.locator,
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

    if (!armLayout) return { episodes: mergeEpisodeVariants(successful), arm: null };

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

    return {
      episodes: mergeEpisodeVariants(canonical),
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
