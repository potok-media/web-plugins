export function createSessionStore() {
  let active = null;
  const resolutionCache = new Map();

  // Balancer links and session tokens expire — bound how long a resolved stream URL may be reused.
  const RESOLUTION_TTL_MS = 30 * 60 * 1000;
  // The playlist pre-resolves every episode at once; without a bound the cache grows per title forever.
  const MAX_RESOLUTION_ENTRIES = 200;

  // Voice is part of the key: online streams bake the dub into the URL (libria, kodik), so
  // one episode resolved under voice A is a WRONG answer for a voice B request.
  const normalizeVoice = (voice) =>
    (typeof voice === 'string' && voice.trim()) ? voice.trim().toLowerCase() : '';

  function cacheKey(providerId, sourceId, season, episode, voice) {
    const p = String(providerId ?? '');
    const src = String(sourceId ?? '');
    const s = String(season ?? '');
    const e = String(episode ?? '');
    const v = normalizeVoice(voice);
    return p ? `${p}:${src}:${s}:${e}:${v}` : null;
  }

  function evictIfNeeded() {
    while (resolutionCache.size >= MAX_RESOLUTION_ENTRIES) {
      const oldest = resolutionCache.keys().next().value;
      if (oldest === undefined) break;
      resolutionCache.delete(oldest);
    }
  }

  return Object.freeze({
    get() { return active; },
    set(value, providerId = null) {
      active = value ? { session: value, providerId } : null;
    },
    clear() { active = null; resolutionCache.clear(); },
    getResolution(providerId, sourceId, season, episode, voice) {
      const key = cacheKey(providerId, sourceId, season, episode, voice);
      if (!key) return null;
      const entry = resolutionCache.get(key);
      if (!entry) return null;
      if (Date.now() - entry.resolvedAt > RESOLUTION_TTL_MS) {
        resolutionCache.delete(key);
        return null;
      }
      // Defensive copy — callers must not mutate cached state.
      return { ...entry.resolution };
    },
    setResolution(providerId, sourceId, season, episode, resolution, voice) {
      const key = cacheKey(providerId, sourceId, season, episode, voice);
      if (!key || !resolution?.streamUrl) return;
      evictIfNeeded();
      // Re-inserting refreshes position, so frequently reused entries survive eviction longest.
      resolutionCache.delete(key);
      resolutionCache.set(key, { resolvedAt: Date.now(), resolution });
    },
    /** Test/diagnostic hook: current number of cached resolutions. */
    resolutionCount() { return resolutionCache.size; },
  });
}
