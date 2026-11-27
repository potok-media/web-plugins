import { providerId, sourceId, sourceQuery, isPlayableUrl } from '../search/searchController.js';
import { createPlaybackPayload } from './playbackMapper.js';
import { providerAccountEnvelope } from '../accounts/accountVault.js';
import { PLUGIN_ID } from '../constants.js';
import { PotokSDK } from 'potok-sdk';

// Providers whose resolve REQUIRES a playback locator captured at search time (AnimeLib has no
// query/sourceId resolve path). Descriptors restored from a saved lastSource do not carry the
// locator, so resolving them is a guaranteed upstream failure — skip them instead of burning a
// request and a PROVIDER FAILED log line on every resume.
const LOCATOR_REQUIRED_PROVIDERS = new Set(['animelib']);

const isLocatorMissing = (candidate) =>
  candidate?.providerId != null
  && LOCATOR_REQUIRED_PROVIDERS.has(String(candidate.providerId).toLowerCase())
  && !candidate?.locator;

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  }
  return value ?? null;
};

const resolutionKey = ({ provider, sourceId: source, query, season, episode, voice, locator }) =>
  JSON.stringify(canonicalValue({ provider, source, query, season, episode, voice, locator }));

export function selectAudio(episode, audioId) {
  const audios = episode?.audios || [];
  const audio = audios.find(item => item.id === audioId) || audios[0];
  if (!audio) return episode;
  return {
    ...episode,
    selectedAudioId: audio.id,
    // `name` is a display label and may contain quality/provider metadata. Keep the
    // semantic voice field clean so cache keys and upstream requests never use that label.
    voice: audio.voice || episode.voice || '',
    url: audio.url || episode.url,
    provider: audio.provider,
    providerId: audio.providerId,
    sourceId: audio.sourceId,
    quality: audio.quality,
    query: audio.query,
  };
}

export function createPlaybackService({
  client,
  episodeService,
  sessionStore,
  pluginId,
  translate,
  playVideo,
  accountVault = null,
}) {
  const safeStr = (v) => v != null ? JSON.parse(JSON.stringify(v)) : undefined;

  async function resolvePlayback(stream, episode, context, episodes, activeEpisodeId) {
    PotokSDK.logging.log('[Playback] resolvePlayback ENTER', {
      stream: safeStr(stream),
      episode: safeStr(episode),
      context: safeStr(context),
      episodes: episodes ? episodes.map(ep => ({ id: ep.id, season: ep.season, episode: ep.episode, url: ep.url })) : undefined,
      activeEpisodeId,
    });
    let selected = episode || stream;
    // Host-side refs may carry the OWNING PLUGIN id in providerId (web uses that field to
    // address the sandbox). It is NOT a balancer slug — resolving with it makes the backend
    // reject the request ("Unknown online provider 'potok-online-balancers'"). Neutralize it;
    // the real slug comes from sourceStream (or the matched candidate).
    if (selected?.providerId === PLUGIN_ID) {
      selected = { ...selected, providerId: undefined };
    }
    if (!episode && selected?.episode == null && stream?.mediaType !== 'movie') {
      const episodeResponse = await episodeService.fetchEpisodes(stream, context);
      if (episodeResponse.episodes[0]) selected = episodeResponse.episodes[0];
    }

    const candidates = selected?.audios?.length ? selected.audios : [selected];
    // An explicitly requested voice (the host sends episode.voice when the user switches the
    // dub) beats the stored selectedAudioId — an explicit user request outranks a stored
    // selection. Match case-insensitively against the candidate's plain voice label or its
    // display name; the host may send EITHER the plain label ("Studio Band") or the full
    // "Voice · Quality · Provider" form ("Studio Band · 720p · Kodik") depending on which
    // surface produced it (menu entry vs remembered HLS track), so both sides are reduced to
    // the plain segment before comparison.
    const normalizeVoice = (value) =>
      (typeof value === 'string' && value.trim()) ? value.trim().toLowerCase() : null;
    const plainVoice = (value) => {
      const normalized = normalizeVoice(value);
      return normalized ? normalized.split('·')[0].trim() : null;
    };
    const requestedVoice = normalizeVoice(selected?.voice);
    const requestedPlain = plainVoice(selected?.voice);
    const voicesMatch = (candidate) =>
      normalizeVoice(candidate?.voice) === requestedVoice
      || normalizeVoice(candidate?.name) === requestedVoice
      || (requestedPlain != null && (
        plainVoice(candidate?.voice) === requestedPlain
        || plainVoice(candidate?.name) === requestedPlain));
    const byRequestedVoice = requestedVoice == null
      ? -1
      : candidates.findIndex(voicesMatch);
    const byId = candidates.findIndex(candidate =>
      candidate?.id != null && candidate?.id === selected?.selectedAudioId);
    let selectedCandidateIndex;
    if (byRequestedVoice >= 0) {
      selectedCandidateIndex = byRequestedVoice;
    } else if (requestedVoice != null) {
      // The requested dub is not among this episode's candidates — fail loudly so the host
      // keeps the current audio instead of silently playing the wrong voice.
      throw new Error(translate('playback.voiceNotFound', {
        voice: selected.voice,
        available: candidates
          .map(candidate => candidate?.name || candidate?.voice)
          .filter(Boolean)
          .join(', '),
      }));
    } else {
      selectedCandidateIndex = byId >= 0 ? byId : 0;
    }
    const candidateOrder = [
      selectedCandidateIndex,
      ...candidates.map((_, index) => index).filter(index => index !== selectedCandidateIndex),
    ];
    // Resolve ONLY the selected candidate. Every extra candidate is a separate upstream
    // resolution of a stream the player will not open — that is the "million requests" trap.
    // Refresh path disabled — always do full resolution so episode params reach the API
    const useRefresh = false;
    if (useRefresh) {
      PotokSDK.logging.log('[Playback] resolvePlayback — using refresh (session exists, episode switch)');
      const refreshResult = await refresh({
        session: stored.session,
        onlineProviderId: stored.providerId,
      });
      const cachedResolution = sessionStore.getResolution(
        stored.providerId,
        sourceId(selected) || sourceId(stream),
        selected?.season,
        selected?.episode,
        selected?.voice,
      );
      const response = refreshResult
        ? { ...cachedResolution, ...Object.fromEntries(Object.entries(refreshResult).filter(([, v]) => v != null)) }
        : cachedResolution;
      const primary = {
        candidateIndex: selectedCandidateIndex,
        target: selected,
        response,
        providerId: stored.providerId,
      };
      const resolved = [primary];
      const primaryIndex = 0;
      sessionStore.set(response.session ?? stored.session, stored.providerId);

      // Resolve playlist episodes — skip only when a real http(s) stream URL is present.
      // Plugin-internal `online-balancers://` handles must go through resolution.
      const playlistEpisodes = episodes || [];
      const primarySourceId = sourceId(primary.target) || sourceId(stream);
      const playlistResolverRequests = playlistEpisodes.map(async (ep) => {
        const existingUrl = ep?.streamUrl ?? ep?.url;
        if (isPlayableUrl(existingUrl)) {
          return { episodeId: ep.id, streamUrl: existingUrl, headers: ep.headers, skip: true };
        }
        const epProviderId = ep.providerId || primary.providerId;
        const epSourceId = ep.sourceId || primarySourceId;
        const epSeason = ep.season ?? context?.season;
        const epEpisode = ep.episode ?? context?.episode;
        const cached = sessionStore.getResolution(epProviderId, epSourceId, epSeason, epEpisode);
        if (isPlayableUrl(cached?.streamUrl)) {
          return { episodeId: ep.id, streamUrl: cached.streamUrl, headers: cached.headers, skip: true };
        }
        const account = epProviderId && accountVault
          ? await accountVault.getAccount(epProviderId)
          : null;
        const response = await client.resolvePlayback({
          provider: epProviderId,
          sourceId: epSourceId,
          query: sourceQuery(ep, context),
          season: epSeason ?? null,
          episode: epEpisode ?? null,
          voice: ep.voice || null,
          ...(account ? { account: providerAccountEnvelope(epProviderId, account) } : {}),
        });
        if (response?.streamUrl) {
          sessionStore.setResolution(epProviderId, epSourceId, epSeason, epEpisode, {
            streamUrl: response.streamUrl,
            streamType: response.streamType,
            voice: response.voice,
            headers: response.headers,
            quality: response.quality,
            variants: response.variants,
          });
        }
        return {
          episodeId: ep.id,
          streamUrl: response?.streamUrl,
          streamType: response?.streamType,
          headers: response?.headers,
          quality: response?.quality,
          variants: response?.variants,
        };
      });
      const playlistResolutions = await Promise.allSettled(playlistResolverRequests);
      const resolvedUrlMap = new Map();
      playlistResolutions.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value?.streamUrl) {
          resolvedUrlMap.set(playlistEpisodes[idx].id, {
            streamUrl: result.value.streamUrl,
            streamType: result.value.streamType,
            headers: result.value.headers,
            quality: result.value.quality,
            variants: result.value.variants,
          });
        }
      });
      PotokSDK.logging.log('[Playback] playlist episodes resolved (refresh path)', {
        total: playlistEpisodes.length,
        resolved: resolvedUrlMap.size,
        urls: Object.fromEntries(resolvedUrlMap),
      });

      return createPlaybackPayload({
        client,
        primary,
        primaryIndex,
        resolved,
        candidates,
        stream,
        selected,
        context,
        pluginId,
        translate,
        episodes,
        activeEpisodeId,
        resolvedUrlMap,
      });
    }

    // Build the complete current-episode + sliding-window resolution plan first. The browser
    // sends this plan as ONE request; fan-out, deduplication, throttling and shared caching live
    // on the backend. The host still receives the same ready-made playlist as before.
    const allPlaylistEpisodes = episodes || [];
    const WINDOW_BEFORE = 3;
    const WINDOW_AFTER = 5;
    const selectedSeason = selected?.season ?? context?.season ?? null;
    const selectedEpisode = selected?.episode ?? context?.episode ?? null;
    let windowAnchor = activeEpisodeId != null
      ? allPlaylistEpisodes.findIndex(ep => String(ep.id) === String(activeEpisodeId))
      : -1;
    if (windowAnchor < 0 && selected?.id != null) {
      windowAnchor = allPlaylistEpisodes.findIndex(ep => ep.id === selected.id);
    }
    if (windowAnchor < 0 && selectedEpisode != null) {
      windowAnchor = allPlaylistEpisodes.findIndex(ep =>
        (ep.season ?? null) === selectedSeason && (ep.episode ?? null) === selectedEpisode);
    }
    if (windowAnchor < 0) windowAnchor = 0;
    const anchorEpisodeId = allPlaylistEpisodes[windowAnchor]?.id ?? null;
    const windowStart = Math.max(0, windowAnchor - WINDOW_BEFORE);
    const windowEnd = Math.min(allPlaylistEpisodes.length, windowAnchor + WINDOW_AFTER + 1);
    const playlistEpisodes = allPlaylistEpisodes
      .slice(windowStart, windowEnd)
      .filter(ep => String(ep.id) !== String(anchorEpisodeId));

    const planned = new Map();
    const resolvedByKey = new Map();
    let nextRequestId = 0;
    const planResolution = ({ provider, source, query, season, episode, voice, locator = null }) => {
      const descriptor = {
        provider,
        sourceId: source,
        query,
        season: season ?? null,
        episode: episode ?? null,
        voice: voice || null,
        locator: locator || null,
      };
      const key = resolutionKey(descriptor);
      if (resolvedByKey.has(key) || planned.has(key)) return descriptor;
      const cached = sessionStore.getResolution(provider, source, season, episode, voice);
      if (cached) {
        resolvedByKey.set(key, { playback: cached, error: null });
        return descriptor;
      }
      planned.set(key, { id: `playback-${nextRequestId++}`, ...descriptor });
      return descriptor;
    };

    const currentDescriptors = candidateOrder
      .map(index => candidates[index])
      .filter(candidate => !isLocatorMissing(candidate))
      .map(candidate => {
        const target = {
          ...selected,
          ...candidate,
          voice: candidate?.voice || selected?.voice || stream?.voice || '',
        };
        return planResolution({
          provider: (typeof target?.providerId === 'string' && target.providerId
            ? target.providerId
            : null) || providerId(stream),
          source: (typeof target?.sourceId === 'string' && target.sourceId
            ? target.sourceId
            : null) || sourceId(stream),
          query: sourceQuery(target, context),
          season: target?.season ?? context?.season ?? null,
          episode: target?.episode ?? context?.episode ?? null,
          voice: target?.voice || null,
          locator: target?.locator || null,
        });
      });
    const fallbackDescriptors = currentDescriptors.length > 0
      ? currentDescriptors
      : [{
          provider: providerId(stream),
          sourceId: sourceId(stream),
          query: sourceQuery(selected, context),
        }];

    for (const ep of playlistEpisodes) {
      if (isPlayableUrl(ep?.streamUrl ?? ep?.url)) continue;
      const epSeason = ep.season ?? context?.season ?? null;
      const epNumber = ep.episode ?? context?.episode ?? null;
      const candidateList = Array.isArray(ep?.audios) ? ep.audios : [];
      const variants = candidateList.length > 0 ? candidateList : [ep];
      for (const candidate of variants) {
        if (isLocatorMissing(candidate)) continue;
        const explicitProvider = candidate?.providerId || ep?.providerId || null;
        const explicitSource = candidate?.sourceId || ep?.sourceId || null;
        const fallbacks = explicitProvider && explicitSource ? [fallbackDescriptors[0]] : fallbackDescriptors;
        for (const fallback of fallbacks) {
          planResolution({
            provider: explicitProvider || fallback.provider,
            source: explicitSource || fallback.sourceId,
            query: candidateList.length > 0
              ? (candidate?.query || sourceQuery(ep, context))
              : sourceQuery(ep, context),
            season: epSeason,
            episode: epNumber,
            voice: candidate?.voice || ep?.voice || null,
            locator: candidate?.locator || ep?.locator || null,
          });
        }
      }
    }

    const pendingItems = [...planned.values()];
    if (pendingItems.length > 0) {
      const accountEntries = await Promise.all([...new Set(pendingItems.map(item => item.provider))]
        .map(async provider => {
          const account = provider && accountVault ? await accountVault.getAccount(provider) : null;
          return account ? [provider, providerAccountEnvelope(provider, account)] : null;
        }));
      const accounts = Object.fromEntries(accountEntries.filter(Boolean));
      let batch;
      if (typeof client.resolvePlaybacks === 'function') {
        batch = await client.resolvePlaybacks(pendingItems, accounts);
      } else {
        // Compatibility for old embedded clients and focused unit-test stubs. Production uses
        // resolvePlaybacks and therefore performs exactly one browser request.
        batch = {
          items: await Promise.all(pendingItems.map(async item => {
            try {
              const playback = await client.resolvePlayback({
                ...item,
                ...(accounts[item.provider] ? { account: accounts[item.provider] } : {}),
              });
              return { id: item.id, playback };
            } catch (error) {
              return { id: item.id, error: error instanceof Error ? error.message : String(error) };
            }
          })),
        };
      }
      const byId = new Map((batch?.items || []).map(item => [item.id, item]));
      for (const [key, item] of planned) {
        const result = byId.get(item.id) || { error: 'Playback batch returned no result.' };
        resolvedByKey.set(key, result);
        const response = result.playback;
        if (response?.streamUrl) {
          sessionStore.setResolution(item.provider, item.sourceId, item.season, item.episode, {
            streamUrl: response.streamUrl,
            streamType: response.streamType,
            voice: response.voice,
            headers: response.headers,
            quality: response.quality,
            variants: response.variants,
          }, item.voice);
        }
      }
    }

    const resolveCandidateStream = async ({ provider, source, query, season, episode, voice, locator = null }) => {
      const key = resolutionKey({ provider, sourceId: source, query, season, episode, voice, locator });
      const result = resolvedByKey.get(key);
      if (result?.playback) return result.playback;
      throw new Error(result?.error || 'Playback was not included in the batch plan.');
    };

    // Resolve the primary: the selected candidate first, then the remaining ones in order.
    // A saved/selected voice whose provider cannot resolve (AnimeLib without its playback
    // locator, a dead balancer) must not kill the whole playback — the first resolvable
    // candidate becomes the primary and the menus/session memory follow it.
    let primaryResponse = null;
    let primaryCandidateIndex = selectedCandidateIndex;
    let primaryTarget = null;
    let lastPrimaryError = null;
    for (const index of candidateOrder) {
      const candidate = candidates[index];
      if (isLocatorMissing(candidate)) {
        PotokSDK.logging.warn('[Playback] candidate skipped: provider requires a locator the descriptor does not carry', {
          providerId: candidate?.providerId,
          voice: candidate?.voice || candidate?.name || null,
        });
        continue;
      }
      const candidateTarget = {
        ...selected,
        ...candidate,
        // `candidate.name` is presentation-only and may contain quality/provider metadata.
        // Only a real provider voice may enter cache keys and backend resolution requests.
        voice: candidate?.voice || selected?.voice || stream?.voice || '',
      };
      try {
        const response = await resolveCandidateStream({
          provider: (typeof candidateTarget?.providerId === 'string' && candidateTarget.providerId
            ? candidateTarget.providerId
            : null) || providerId(stream),
          source: (typeof candidateTarget?.sourceId === 'string' && candidateTarget.sourceId
            ? candidateTarget.sourceId
            : null) || sourceId(stream),
          query: sourceQuery(candidateTarget, context),
          season: candidateTarget?.season ?? context?.season ?? null,
          episode: candidateTarget?.episode ?? context?.episode ?? null,
          voice: candidateTarget?.voice || null,
          locator: candidateTarget?.locator || null,
        });
        if (response?.streamUrl) {
          primaryResponse = response;
          primaryCandidateIndex = index;
          primaryTarget = candidateTarget;
          break;
        }
      } catch (error) {
        lastPrimaryError = error;
        PotokSDK.logging.warn('[Playback] candidate resolve failed, trying the next one', {
          voice: candidateTarget?.voice,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!primaryResponse?.streamUrl || !primaryTarget) {
      throw new Error(translate('playback.failed'), { cause: lastPrimaryError ?? undefined });
    }
    const target = primaryTarget;
    // Provider for the resolve call: ONLY an explicit providerId on the target counts —
    // episode ids like "1:1" (season:episode) must never be id-derived into a bogus slug,
    // and the host may leave its own plugin id there (sanitized above). Fall back to the
    // sourceStream's provider — the stream the user actually clicked.
    const explicitTargetProvider =
      typeof target?.providerId === 'string' && target.providerId ? target.providerId : null;
    const explicitTargetSource =
      typeof target?.sourceId === 'string' && target.sourceId ? target.sourceId : null;
    const primaryProvider = explicitTargetProvider || providerId(stream);
    const primarySource = explicitTargetSource || sourceId(stream);
    const primarySeason = target?.season ?? context?.season ?? null;
    const primaryEpisode = target?.episode ?? context?.episode ?? null;
    const primaryVoice = target?.voice || null;

    if (primaryResponse.session) {
      sessionStore.set(primaryResponse.session, primaryProvider);
    }
    const primary = {
      candidateIndex: primaryCandidateIndex,
      target,
      response: primaryResponse,
      providerId: primaryProvider,
    };
    const primaryIndex = 0;
    const resolved = [primary];
    // Explicit field only on the target — episode ids ("kodik:serial-16224:1:2") must not be
    // id-derived into polluted sourceIds; the stream's sourceId is the correct fallback.
    const primarySourceId =
      (typeof primary.target?.sourceId === 'string' && primary.target.sourceId
        ? primary.target.sourceId
        : null) || sourceId(stream);

    // Remaining voice candidates of the CURRENT episode — resolved so the player's audio
    // menu holds ready URLs (a voice switch is a local swap, not a re-resolve). Failures
    // leave the candidate's url blank; the primary above is the only hard requirement.
    const candidateUrls = new Map([[primaryCandidateIndex, {
      url: primaryResponse.streamUrl,
      headers: primaryResponse.headers,
    }]]);
    await Promise.all(candidates.map(async (candidate, index) => {
      if (index === primaryCandidateIndex) return;
      // Host callbacks can strip the candidate's semantic voice while retaining only its
      // display name. Planning deliberately falls back to the selected voice in that case;
      // use the same descriptor here so the already-resolved batch entry is found.
      const voice = candidate?.voice || selected?.voice || stream?.voice || null;
      if (isLocatorMissing(candidate)) return;
      try {
        const response = await resolveCandidateStream({
          provider: candidate?.providerId || providerId(stream),
          source: candidate?.sourceId || sourceId(stream),
          query: sourceQuery({ ...selected, ...candidate }, context),
          season: primarySeason,
          episode: primaryEpisode,
          voice,
          locator: candidate?.locator || null,
        });
        if (response?.streamUrl) {
          candidateUrls.set(index, { url: response.streamUrl, headers: response.headers });
        }
      } catch (error) {
        PotokSDK.logging.warn('[Playback] candidate voice resolve failed', {
          voice,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }));

    // Resolve a sliding window around the selected episode — 3 before, 5 after. EVERY voice
    // candidate of EVERY window episode is resolved (through the candidate's OWN provider),
    // so the payload leaves complete: playlist items carry ready streamUrls and ready
    // per-candidate audios; the player never resolves anything. Episodes outside the window
    // keep their pseudo `online-balancers://` handle — the plugin re-windows on a far-jump
    // click via replacePlaylist. Episodes with a real http(s) URL are skipped.
    const windowResults = await Promise.all(playlistEpisodes.map(async (ep) => {
      const existingUrl = ep?.streamUrl ?? ep?.url;
      if (isPlayableUrl(existingUrl)) {
        return { episodeId: ep.id, streamUrl: existingUrl, headers: ep.headers, audios: null, skip: true };
      }
      const epSeason = ep.season ?? context?.season ?? null;
      const epNumber = ep.episode ?? context?.episode ?? null;
      const candidateList = Array.isArray(ep?.audios) ? ep.audios : [];

      // Episodes without candidate metadata: one legacy resolution through the stream's
      // provider with the episode's own voice.
      if (candidateList.length === 0) {
        if (isLocatorMissing(ep)) {
          return { episodeId: ep.id, streamUrl: null, headers: null, audios: null };
        }
        const voice = ep.voice || null;
        try {
          const response = await resolveCandidateStream({
            provider: ep.providerId || primary.providerId,
            source: ep.sourceId || primarySourceId,
            query: sourceQuery(ep, context),
            season: epSeason,
            episode: epNumber,
            voice,
            locator: ep?.locator || null,
          });
          return {
            episodeId: ep.id,
            streamUrl: response?.streamUrl ?? null,
            headers: response?.headers ?? null,
            audios: null,
          };
        } catch (error) {
          PotokSDK.logging.warn('[Playback] window episode resolve failed', {
            episodeId: ep.id,
            reason: error instanceof Error ? error.message : String(error),
          });
          return { episodeId: ep.id, streamUrl: null, headers: null, audios: null };
        }
      }

      // Full candidate set: resolve every voice variant so the player's menu is ready-made.
      const resolvedAudios = [];
      await Promise.all(candidateList.map(async (candidate, index) => {
        const voice = candidate?.voice || null;
        if (isLocatorMissing(candidate)) return;
        try {
          const response = await resolveCandidateStream({
            provider: candidate?.providerId || ep.providerId || primary.providerId,
            source: candidate?.sourceId || ep.sourceId || primarySourceId,
            query: candidate?.query || sourceQuery(ep, context),
            season: epSeason,
            episode: epNumber,
            voice,
            locator: candidate?.locator || ep?.locator || null,
          });
          if (response?.streamUrl) {
            resolvedAudios[index] = { url: response.streamUrl, headers: response.headers };
          }
        } catch (error) {
          PotokSDK.logging.warn('[Playback] window candidate resolve failed', {
            episodeId: ep.id,
            voice,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }));

      // The item's streamUrl follows the voice being listened to (the matched candidate),
      // falling back to the episode's default voice, then any resolved variant. Match on the
      // plain voice segment — the remembered voice may arrive as a short label or a full
      // "Voice · Quality · Provider" form.
      const matchIndex = (voice) => {
        const wanted = normalizeVoice(voice);
        const wantedPlain = plainVoice(voice);
        if (wanted == null) return -1;
        return candidateList.findIndex(candidate =>
          normalizeVoice(candidate?.voice) === wanted
          || normalizeVoice(candidate?.name) === wanted
          || (wantedPlain != null && (
            plainVoice(candidate?.voice) === wantedPlain
            || plainVoice(candidate?.name) === wantedPlain)));
      };
      let chosenIndex = matchIndex(requestedVoice);
      if (chosenIndex < 0) chosenIndex = matchIndex(ep.voice);
      if (chosenIndex < 0) chosenIndex = resolvedAudios.findIndex(entry => entry?.url);
      const chosen = chosenIndex >= 0 ? resolvedAudios[chosenIndex] : null;
      return {
        episodeId: ep.id,
        streamUrl: chosen?.url ?? null,
        headers: chosen?.headers ?? null,
        audios: resolvedAudios,
      };
    }));

    const resolvedUrlMap = new Map();
    let windowResolved = 0;
    for (const result of windowResults) {
      if (result.streamUrl) {
        resolvedUrlMap.set(result.episodeId, {
          streamUrl: result.streamUrl,
          headers: result.headers,
          audios: result.audios,
        });
        windowResolved += 1;
      }
    }
    // The anchor itself is resolved (it IS the primary) — publish its ready urls into the
    // playlist item too, so every item of the payload is complete.
    if (anchorEpisodeId != null && !resolvedUrlMap.has(anchorEpisodeId)) {
      resolvedUrlMap.set(anchorEpisodeId, {
        streamUrl: primaryResponse.streamUrl,
        headers: primaryResponse.headers,
        audios: candidates.map((candidate, index) => candidateUrls.get(index) ?? null),
      });
    }
    PotokSDK.logging.log('[Playback] playlist window resolved', {
      total: allPlaylistEpisodes.length,
      window: playlistEpisodes.length,
      windowStart,
      windowAnchor,
      resolved: windowResolved,
    });

    return createPlaybackPayload({
      client,
      primary,
      primaryIndex,
      resolved,
      candidates,
      stream,
      selected,
      context,
      pluginId,
      translate,
      episodes,
      // The payload index must anchor on the actually-resolved episode even when the caller
      // did not name it (older hosts) — otherwise the payload points at playlist[0] and the
      // player mounts the wrong, unresolved item.
      activeEpisodeId: activeEpisodeId ?? anchorEpisodeId ?? selected?.id ?? null,
      resolvedUrlMap,
      candidateUrls,
    });
  }

  async function refresh(payload) {
    const stored = sessionStore.get();
    const session = payload?.session || payload?.playbackInfo?.session || stored?.session;
    const sourceProviderId = payload?.onlineProviderId || payload?.playbackInfo?.onlineProviderId
      || stored?.providerId;
    if (!session) throw new Error(translate('playback.missingSession'));
    const account = sourceProviderId && accountVault
      ? await accountVault.getAccount(sourceProviderId)
      : null;
    const response = await client.refreshPlayback(
      session,
      account ? providerAccountEnvelope(sourceProviderId, account) : null,
    );
    sessionStore.set(response.session || session, sourceProviderId);
    return {
      streamUrl: response.streamUrl,
      streamType: response.streamType || 'm3u8',
      voice: response.voice,
    };
  }

  async function play(stream, episode, context, episodes, activeEpisodeId) {
    PotokSDK.logging.log('[Playback] play ENTER', {
      stream: safeStr(stream),
      episode: safeStr(episode),
      context: safeStr(context),
      episodes: episodes ? episodes.map(ep => ({ id: ep.id, season: ep.season, episode: ep.episode, url: ep.url })) : undefined,
      activeEpisodeId,
    });
    const payload = await resolvePlayback(stream, episode, context, episodes, activeEpisodeId);
    PotokSDK.logging.log('[Playback] play — payload built', {
      streamUrl: payload.streamUrl,
      streamType: payload.streamType,
      title: payload.title,
      season: payload.season,
      episode: payload.episode,
      playlistLength: payload.playlist?.length,
      playlistIndex: payload.playlistIndex,
      playlistUrls: payload.playlist?.map(ep => ({ id: ep.id, streamUrl: ep.streamUrl })),
      hasSourceStream: !!payload.sourceStream,
      sourceStream: payload.sourceStream,
      providerId: payload.providerId,
      onlineProviderId: payload.onlineProviderId,
    });
    if (typeof playVideo !== 'function') throw new Error(translate('playback.failed'));
    // The plugin page renders the InlinePlayer stage — request inline mounting so the host embeds
    // the player there instead of lifting the fullscreen overlay.
    const inlinePayload = { ...payload, mount: 'inline' };
    PotokSDK.logging.log('[Playback] play — calling playVideo with payload (mount=inline)');
    playVideo(inlinePayload);
    return payload;
  }

  return Object.freeze({ resolvePlayback, play, refresh });
}
