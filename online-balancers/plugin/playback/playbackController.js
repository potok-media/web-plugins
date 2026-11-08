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

    // Full resolution — check cache for the selected candidate first
    const settled = await Promise.allSettled([candidateToResolve].map(async (candidate) => {
      const target = {
        ...selected,
        ...candidate,
        voice: candidate?.voice || candidate?.name || selected?.voice || stream?.voice || null,
      };
      // Provider for the resolve call: ONLY an explicit providerId on the target counts —
      // episode ids like "1:1" (season:episode) must never be id-derived into a bogus slug,
      // and the host may leave its own plugin id there (sanitized above). Fall back to the
      // sourceStream's provider — the stream the user actually clicked.
      const explicitTargetProvider =
        typeof target?.providerId === 'string' && target.providerId ? target.providerId : null;
      const explicitTargetSource =
        typeof target?.sourceId === 'string' && target.sourceId ? target.sourceId : null;
      const id = explicitTargetProvider || providerId(stream);
      const src = explicitTargetSource || sourceId(stream);
      const season = target?.season ?? context?.season ?? null;
      const episode = target?.episode ?? context?.episode ?? null;
      const voice = target?.voice || null;

      // Check cache before HTTP call — keyed by provider+source+episode, NOT voice:
      // voices of one source share the same resolved stream, and the episode-selector
      // voice labels would otherwise fragment the cache into misses.
      const cached = sessionStore.getResolution(id, src, season, episode, voice);
      if (cached) {
        console.log('[Playback] resolvePlayback — cache HIT for', { id, src, season, episode });
        return {
          candidateIndex: selectedCandidateIndex,
          target,
          response: cached,
          providerId: id,
        };
      }

      const account = accountVault ? await accountVault.getAccount(id) : null;
      const response = await client.resolvePlayback({
        provider: id,
        sourceId: src,
        query: sourceQuery(target, context),
        season,
        episode,
        voice,
        ...(account ? { account: providerAccountEnvelope(id, account) } : {}),
      });

      // Cache the streamUrl and voice — createPlaybackPayload needs both (voice-keyed: a
      // dub-specific stream must never satisfy a different-dub request).
      if (response?.streamUrl) {
        sessionStore.setResolution(id, src, season, episode, {
          streamUrl: response.streamUrl,
          streamType: response.streamType,
          voice: response.voice,
          headers: response.headers,
        }, voice);
      }

      return { candidateIndex: selectedCandidateIndex, target, response, providerId: id };
    }));
    const resolved = settled.filter(result => result.status === 'fulfilled').map(result => result.value);
    if (!resolved.length) {
      const failure = settled.find(result => result.status === 'rejected');
      throw failure?.reason || new Error(translate('playback.failed'));
    }

    const primary = resolved.find(item => item.candidateIndex === selectedCandidateIndex) || resolved[0];
    const primaryIndex = resolved.indexOf(primary);
    if (primary.response?.session) {
      sessionStore.set(primary.response.session, primary.providerId);
    }

    // Resolve ONLY a sliding window around the selected episode — 3 before, the selected one,
    // 5 after (≤9 upstream resolutions per playback start). Resolving the whole list up front
    // fires one backend/balancer request per episode (a 148-episode series = 148 requests at
    // once). Episodes outside the window keep their pseudo `online-balancers://` handle in the
    // playlist — the host resolves on click when the user jumps far away. Episodes with a real
    // http(s) URL cost nothing and are still skipped below.
    //
    // The window runs in the BACKGROUND: the payload (and the player open) must not wait for
    // up to 9 upstream resolutions. Playlist navigation re-resolves through the host resolver
    // and hits the voice-keyed cache below once the window lands.
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
    // Explicit field only on the target — episode ids ("kodik:serial-16224:1:2") must not be
    // id-derived into polluted sourceIds; the stream's sourceId is the correct fallback.
    const primarySourceId =
      (typeof primary.target?.sourceId === 'string' && primary.target.sourceId
        ? primary.target.sourceId
        : null) || sourceId(stream);
    const playlistResolverRequests = playlistEpisodes.map(async (ep) => {
      const existingUrl = ep?.streamUrl ?? ep?.url;
      if (isPlayableUrl(existingUrl)) {
        return { episodeId: ep.id, streamUrl: existingUrl, headers: ep.headers, skip: true };
      }
      const epProviderId = ep.providerId || primary.providerId;
      const epSourceId = ep.sourceId || primarySourceId;
      const epSeason = ep.season ?? context?.season;
      const epEpisode = ep.episode ?? context?.episode;
      const epVoice = ep.voice || null;

      // Check cache before HTTP call (voice-keyed: a dub-specific stream is not interchangeable)
      const cached = sessionStore.getResolution(epProviderId, epSourceId, epSeason, epEpisode, epVoice);
      if (isPlayableUrl(cached?.streamUrl)) {
        console.log('[Playback] playlist cache HIT for', { episodeId: ep.id, season: epSeason, episode: epEpisode, voice: epVoice });
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
        voice: epVoice,
        ...(account ? { account: providerAccountEnvelope(epProviderId, account) } : {}),
      });

      // Cache only the streamUrl, streamType, voice and headers — other fields come from the episode/target
      if (response?.streamUrl) {
        sessionStore.setResolution(epProviderId, epSourceId, epSeason, epEpisode, {
          streamUrl: response.streamUrl,
          streamType: response.streamType,
          voice: response.voice,
          headers: response.headers,
        }, epVoice);
      }

      return { episodeId: ep.id, streamUrl: response?.streamUrl, headers: response?.headers };
    });

    // Background window: the payload returns immediately; window failures stay in the log.
    void Promise.allSettled(playlistResolverRequests).then((playlistResolutions) => {
      const resolvedCount = playlistResolutions.filter(
        result => result.status === 'fulfilled' && result.value?.streamUrl,
      ).length;
      const failedCount = playlistResolutions.length - resolvedCount;
      console.log('[Playback] playlist window resolved (background)', {
        total: allPlaylistEpisodes.length,
        window: playlistEpisodes.length,
        windowStart,
        windowAnchor,
        resolved: resolvedCount,
        failed: failedCount,
      });
      playlistResolutions.forEach((result, idx) => {
        if (result.status === 'rejected') {
          console.warn('[Playback] window episode resolve failed:', {
            episodeId: playlistEpisodes[idx]?.id,
            reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      });
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
      resolvedUrlMap: new Map(),
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
