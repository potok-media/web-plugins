import { providerId, sourceId, sourceQuery, isPlayableUrl } from '../search/searchController.js';
import { createPlaybackPayload } from './playbackMapper.js';
import { providerAccountEnvelope } from '../accounts/accountVault.js';
import { PLUGIN_ID } from '../constants.js';

export function selectAudio(episode, audioId) {
  const audios = episode?.audios || [];
  const audio = audios.find(item => item.id === audioId) || audios[0];
  if (!audio) return episode;
  return {
    ...episode,
    selectedAudioId: audio.id,
    voice: audio.voice || audio.name || episode.voice,
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
    console.log('[Playback] resolvePlayback ENTER', {
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
    // display name; the host may strip audio ids when forwarding a playlist item, so the
    // voice/name match is also what keeps the selected dub alive across the round trip.
    const normalizeVoice = (value) =>
      (typeof value === 'string' && value.trim()) ? value.trim().toLowerCase() : null;
    const requestedVoice = normalizeVoice(selected?.voice);
    const byRequestedVoice = requestedVoice == null
      ? -1
      : candidates.findIndex(candidate =>
          normalizeVoice(candidate?.voice) === requestedVoice
          || normalizeVoice(candidate?.name) === requestedVoice);
    const byId = candidates.findIndex(candidate =>
      candidate?.id != null && candidate?.id === selected?.selectedAudioId);
    let selectedCandidateIndex;
    if (byRequestedVoice >= 0) {
      selectedCandidateIndex = byRequestedVoice;
    } else if (requestedVoice != null) {
      // The requested dub is not among this episode's candidates — fail loudly so the host
      // keeps the current audio instead of silently playing the wrong voice.
      throw new Error(translate('playback.voiceNotFound', { voice: selected.voice }));
    } else {
      selectedCandidateIndex = byId >= 0 ? byId : 0;
    }
    // Resolve ONLY the selected candidate. Every extra candidate is a separate upstream
    // resolution of a stream the player will not open — that is the "million requests" trap.
    const candidateToResolve = candidates[selectedCandidateIndex];

    // Refresh path disabled — always do full resolution so episode params reach the API
    const useRefresh = false;

    if (useRefresh) {
      console.log('[Playback] resolvePlayback — using refresh (session exists, episode switch)');
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
          });
        }
        return { episodeId: ep.id, streamUrl: response?.streamUrl, headers: response?.headers };
      });
      const playlistResolutions = await Promise.allSettled(playlistResolverRequests);
      const resolvedUrlMap = new Map();
      playlistResolutions.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value?.streamUrl) {
          resolvedUrlMap.set(playlistEpisodes[idx].id, {
            streamUrl: result.value.streamUrl,
            headers: result.value.headers,
          });
        }
      });
      console.log('[Playback] playlist episodes resolved (refresh path)', {
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

    // Full resolution. The payload must leave this function COMPLETE: every voice candidate
    // of the current episode and every episode of the window carries a ready streamUrl, so
    // the player never resolves anything itself. All resolutions go through the voice-keyed
    // cache and the candidate's OWN provider/source/query.
    const resolveCandidateStream = async ({ provider: candidateProvider, source: candidateSource, query: candidateQuery, season, episode, voice }) => {
      const cached = sessionStore.getResolution(candidateProvider, candidateSource, season, episode, voice);
      if (cached) {
        console.log('[Playback] resolvePlayback — cache HIT for', { id: candidateProvider, src: candidateSource, season, episode, voice });
        return cached;
      }
      const account = candidateProvider && accountVault ? await accountVault.getAccount(candidateProvider) : null;
      const response = await client.resolvePlayback({
        provider: candidateProvider,
        sourceId: candidateSource,
        query: candidateQuery,
        season,
        episode,
        voice,
        ...(account ? { account: providerAccountEnvelope(candidateProvider, account) } : {}),
      });
      if (response?.streamUrl) {
        sessionStore.setResolution(candidateProvider, candidateSource, season, episode, {
          streamUrl: response.streamUrl,
          streamType: response.streamType,
          voice: response.voice,
          headers: response.headers,
        }, voice);
      }
      return response;
    };

    const target = {
      ...selected,
      ...candidateToResolve,
      voice: candidateToResolve?.voice || candidateToResolve?.name || selected?.voice || stream?.voice || null,
    };
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

    const primaryResponse = await resolveCandidateStream({
      provider: primaryProvider,
      source: primarySource,
      query: sourceQuery(target, context),
      season: primarySeason,
      episode: primaryEpisode,
      voice: primaryVoice,
    });
    if (!primaryResponse?.streamUrl) {
      throw new Error(translate('playback.failed'));
    }
    if (primaryResponse.session) {
      sessionStore.set(primaryResponse.session, primaryProvider);
    }
    const primary = {
      candidateIndex: selectedCandidateIndex,
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
    // leave the candidate's url blank; the selected one above is the only hard requirement.
    const candidateUrls = new Map([[selectedCandidateIndex, {
      url: primaryResponse.streamUrl,
      headers: primaryResponse.headers,
    }]]);
    await Promise.all(candidates.map(async (candidate, index) => {
      if (index === selectedCandidateIndex) return;
      const voice = candidate?.voice || candidate?.name || null;
      if (!voice) return;
      try {
        const response = await resolveCandidateStream({
          provider: candidate?.providerId || providerId(stream),
          source: candidate?.sourceId || sourceId(stream),
          query: candidate?.query || sourceQuery(selected, context),
          season: primarySeason,
          episode: primaryEpisode,
          voice,
        });
        if (response?.streamUrl) {
          candidateUrls.set(index, { url: response.streamUrl, headers: response.headers });
        }
      } catch (error) {
        console.warn('[Playback] candidate voice resolve failed:', {
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
    // The anchor was JUST resolved as the primary — including it would re-resolve the same
    // episode (the episode's default voice often differs from the requested one, so the
    // voice-keyed cache misses) and waste an upstream call.
    const playlistEpisodes = allPlaylistEpisodes
      .slice(windowStart, windowEnd)
      .filter(ep => String(ep.id) !== String(anchorEpisodeId));

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
        const voice = ep.voice || null;
        try {
          const response = await resolveCandidateStream({
            provider: ep.providerId || primary.providerId,
            source: ep.sourceId || primarySourceId,
            query: sourceQuery(ep, context),
            season: epSeason,
            episode: epNumber,
            voice,
          });
          return {
            episodeId: ep.id,
            streamUrl: response?.streamUrl ?? null,
            headers: response?.headers ?? null,
            audios: null,
          };
        } catch (error) {
          console.warn('[Playback] window episode resolve failed:', {
            episodeId: ep.id,
            reason: error instanceof Error ? error.message : String(error),
          });
          return { episodeId: ep.id, streamUrl: null, headers: null, audios: null };
        }
      }

      // Full candidate set: resolve every voice variant so the player's menu is ready-made.
      const resolvedAudios = [];
      await Promise.all(candidateList.map(async (candidate, index) => {
        const voice = candidate?.voice || candidate?.name || null;
        if (!voice) return;
        try {
          const response = await resolveCandidateStream({
            provider: candidate?.providerId || ep.providerId || primary.providerId,
            source: candidate?.sourceId || ep.sourceId || primarySourceId,
            query: candidate?.query || sourceQuery(ep, context),
            season: epSeason,
            episode: epNumber,
            voice,
          });
          if (response?.streamUrl) {
            resolvedAudios[index] = { url: response.streamUrl, headers: response.headers };
          }
        } catch (error) {
          console.warn('[Playback] window candidate resolve failed:', {
            episodeId: ep.id,
            voice,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }));

      // The item's streamUrl follows the voice being listened to (the matched candidate),
      // falling back to the episode's default voice, then any resolved variant.
      const matchIndex = (voice) => {
        const wanted = normalizeVoice(voice);
        if (wanted == null) return -1;
        return candidateList.findIndex(candidate =>
          normalizeVoice(candidate?.voice) === wanted
          || normalizeVoice(candidate?.name) === wanted);
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
    console.log('[Playback] playlist window resolved', {
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
      activeEpisodeId,
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
    console.log('[Playback] play ENTER', {
      stream: safeStr(stream),
      episode: safeStr(episode),
      context: safeStr(context),
      episodes: episodes ? episodes.map(ep => ({ id: ep.id, season: ep.season, episode: ep.episode, url: ep.url })) : undefined,
      activeEpisodeId,
    });
    const payload = await resolvePlayback(stream, episode, context, episodes, activeEpisodeId);
    console.log('[Playback] play — payload built', {
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
    console.log('[Playback] play — calling playVideo with payload (mount=inline)');
    playVideo(inlinePayload);
    return payload;
  }

  return Object.freeze({ resolvePlayback, play, refresh });
}
