import { providerId, sourceId, sourceQuery } from '../search/searchController.js';
import { mergeEpisodeVariants, movieEpisode } from './mergeVariants.js';
import { providerAccountEnvelope } from '../accounts/accountVault.js';
import { canonicalizeAnimeEpisodes, resolveAnimeArmLayout } from './armEpisodes.js';

/**
 * Episodes are presented to the host UNRESOLVED: items keep their provider-returned URL (when
 * the balancer hands a direct link) or an empty/pseudo one. Nothing plays a panel item without
 * routing through the plugin's play callback, and that path resolves the selected episode plus
 * a small window around it (see playbackController) — resolving the whole list here fired one
 * /api/v1/playback request per episode the moment the user merely opened the episode panel.
 *
 * @param {{
 *   client: any,
 *   translate: (key: string, values?: Record<string, unknown>) => string,
 *   accountVault?: any,
 *   arm?: any,
 *   concurrency?: number,
 * }} dependencies
 */
export function createEpisodeService({ client, translate, accountVault = null, arm = null, concurrency = 6 }) {
  // One ARM layout per service lifetime: the grouped flow resolves it separately (with
  // entryId scoping), single-source callers (continue-watching resume) share this promise.
  let armIdentityLayoutPromise = null;
  const armIdentityLayout = (context) => {
    if (!arm) return Promise.resolve(null);
    if (!armIdentityLayoutPromise) {
      armIdentityLayoutPromise = resolveAnimeArmLayout(arm, { ...context }).catch(() => null);
    }
    return armIdentityLayoutPromise;
  };

  async function fetchEpisodes(stream, context, options = {}) {
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
    let episodes = (response.episodes || []).map(item => ({
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
    }));

    // Single-source callers (the continue-watching resume above all) must attach the ARM
    // identity like the grouped flow does: without workId/episodeId the host falls back to
    // tmdb coordinates, progress/resume keys fork into a second identity space, and the same
    // episode lands in continue-watching twice.
    if (options.withArmIdentity) {
      const armLayout = await armIdentityLayout(context || {});
      if (armLayout) {
        const canonicalized = canonicalizeAnimeEpisodes(episodes, armLayout);
        if (canonicalized.episodes.length) episodes = canonicalized.episodes;
      }
    }

    return {
      episodes,
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
    // The layout is scoped by the entry the OPENED SOURCE was cast to (group id === entryId) —
    // a page-level entryId hint is deliberately NOT used: the online page shows every source,
    // and each source's episodes are laid out by its own identified entry. Sources the casting
    // could not bind keep the full-franchise layout (previous behavior).
    const armLayout = await resolveAnimeArmLayout(
      arm,
      { ...context, entryId: group.entryId || undefined },
    ).catch(() => null);

    if (!armLayout) {
      return { episodes: mergeEpisodeVariants(successful), arm: null };
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

    return {
      episodes: merged,
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
