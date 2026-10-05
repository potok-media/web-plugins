import { PotokSDK } from 'potok-sdk';

// Opening a card goes through OUR ARM graph: the card already carries malId, so one resolve +
// one layout read give the exact bridged TMDB coordinate. No title search, no third-party id
// bridges — the graph is the source of truth for identity and structure.
const KIND_RANK = {
  season: 0, sides: 1, movie: 2, ova: 3, specials: 4,
};

function kindRank(kind) {
  return KIND_RANK[kind] ?? 5;
}

// The group a card opens into: must carry a TMDB bridge and at least one episode (a group
// without episodes is never shown). Main content first (season → sides → movie → ova →
// specials), then the lowest number inside one kind.
export function pickOpenTarget(groups) {
  const candidates = (groups || []).filter(
    (g) => g && g.tmdbShow != null && Array.isArray(g.episodes) && g.episodes.length > 0,
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => (kindRank(a.kind) - kindRank(b.kind)) || ((a.number ?? 0) - (b.number ?? 0)));
  return candidates[0];
}

/** malId → { id, mediaType } for /media/<type>/<id>, or null when the graph has no bridge. */
export async function resolveArmOpen(meta) {
  if (!meta || meta.malId == null) return null;

  let resolution;
  try {
    resolution = await PotokSDK.arm.resolveWork({
      provider: 'mal',
      entityKind: 'anime',
      value: String(meta.malId),
    });
  } catch (e) {
    return null;
  }
  if (!resolution || !resolution.workId) return null;

  let layout;
  try {
    layout = await PotokSDK.arm.getEpisodeLayout(resolution.workId);
  } catch (e) {
    return null;
  }
  const group = pickOpenTarget(layout && layout.groups);
  if (!group) return null;

  // A bridged season coordinate means a TMDB tv show; no season means a movie id.
  return {
    id: Number(group.tmdbShow),
    mediaType: group.tmdbSeason != null ? 'tv' : 'movie',
  };
}
