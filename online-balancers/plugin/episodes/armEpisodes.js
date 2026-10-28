function numeric(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sortedEpisodes(episodes = []) {
  return [...episodes]
    .filter(episode => numeric(episode?.number ?? episode?.episode) != null)
    .sort((left, right) =>
      numeric(left.number ?? left.episode, 0) - numeric(right.number ?? right.episode, 0));
}

function canonicalGroups(layout) {
  return (layout?.groups || [])
    .filter(group => Array.isArray(group?.episodes) && group.episodes.length > 0)
    .map((group, index) => ({
      ...group,
      number: numeric(group.number, index + 1),
      episodes: sortedEpisodes(group.episodes),
    }))
    .sort((left, right) => left.number - right.number);
}

function isAnimeLayout(groups) {
  return groups.some(group => group.aniListId != null || group.malId != null);
}

export async function resolveAnimeArmLayout(arm, context = {}) {
  if (!arm?.getEpisodeLayout || context.type !== 'tv') return null;

  let workId = context.workId || context.arm?.workId || null;
  let graphVersion = context.graphVersion || context.arm?.graphVersion || null;
  if (!workId && context.tmdbId && arm.resolveWork) {
    const resolved = await arm.resolveWork({
      provider: 'tmdb',
      entityKind: 'tv',
      value: String(context.tmdbId),
    });
    workId = resolved?.workId || null;
    graphVersion = resolved?.graphVersion || graphVersion;
  }
  if (!workId) return null;

  const layout = await arm.getEpisodeLayout(workId);
  const groups = canonicalGroups(layout);
  if (!groups.length || !isAnimeLayout(groups)) return null;

  return {
    workId,
    graphVersion: layout?.graphVersion || graphVersion || null,
    groups,
  };
}

function rawEpisodeBlocks(episodes = []) {
  const blocks = new Map();
  for (const episode of episodes) {
    const season = numeric(episode?.season, 1);
    if (!blocks.has(season)) blocks.set(season, []);
    blocks.get(season).push(episode);
  }
  return [...blocks.entries()]
    .map(([season, items]) => ({ season, episodes: sortedEpisodes(items) }))
    .sort((left, right) => left.season - right.season);
}

function blockFitsGroup(block, group) {
  if (block.episodes.length > group.episodes.length) return false;
  const canonicalNumbers = new Set(group.episodes.map(episode => numeric(episode.number)));
  return block.episodes.every(episode => canonicalNumbers.has(numeric(episode.episode)));
}

function canonicalEpisode(group, rawEpisode, index, byOrdinal = false) {
  if (byOrdinal) return group.episodes[index] || null;
  const number = numeric(rawEpisode.episode);
  return group.episodes.find(episode => numeric(episode.number) === number)
    || group.episodes[index]
    || null;
}

function resolvedEpisode(rawEpisode, armEpisode, group, armLayout) {
  return {
    ...rawEpisode,
    rawSeason: rawEpisode.season,
    rawEpisode: rawEpisode.episode,
    season: group.number,
    episode: armEpisode.number,
    workId: armLayout.workId,
    entryId: group.id,
    episodeId: armEpisode.id,
    groupTitle: group.title || null,
    groupDisplayNumber: group.number,
    groupKind: group.kind || 'season',
    displayOrdinal: String(armEpisode.number),
    resolutionState: 'resolved',
    confidence: 1,
    bindingMethod: 'arm-layout',
    rawEvidence: {
      kind: 'episode',
      season: rawEpisode.season,
      episode: rawEpisode.episode,
    },
    title: armEpisode.title || rawEpisode.title,
    overview: armEpisode.overview || null,
    stillPath: armEpisode.stillPath || null,
    airDate: armEpisode.airDate || null,
    filler: armEpisode.filler || null,
    tmdb: armEpisode.tmdb || null,
  };
}

function mapBlock(block, group, armLayout, byOrdinal = false) {
  const resolved = [];
  const unresolved = [];
  block.episodes.forEach((episode, index) => {
    const armEpisode = canonicalEpisode(group, episode, index, byOrdinal);
    if (armEpisode) resolved.push(resolvedEpisode(episode, armEpisode, group, armLayout));
    else unresolved.push(episode);
  });
  return { resolved, unresolved };
}

export function canonicalizeAnimeEpisodes(episodes, armLayout) {
  const blocks = rawEpisodeBlocks(episodes);
  const groups = armLayout?.groups || [];
  if (!blocks.length || !groups.length) return { episodes: [], unresolved: [...(episodes || [])] };

  if (blocks.length === 1 && groups.length === 1) {
    const mapped = mapBlock(blocks[0], groups[0], armLayout);
    return { episodes: mapped.resolved, unresolved: mapped.unresolved };
  }

  const totalRaw = blocks.reduce((total, block) => total + block.episodes.length, 0);
  const totalCanonical = groups.reduce((total, group) => total + group.episodes.length, 0);
  if (blocks.length === 1 && groups.length === 1 && totalRaw === totalCanonical) {
    const resolved = mapBlock(blocks[0], groups[0], armLayout);
    return { episodes: resolved.resolved, unresolved: resolved.unresolved };
  }

  const assignments = new Map();
  const usedGroups = new Set();
  blocks.forEach((block, blockIndex) => {
    const exactIndex = groups.findIndex((group, groupIndex) =>
      !usedGroups.has(groupIndex)
      && group.number === block.season
      && blockFitsGroup(block, group));
    if (exactIndex >= 0) {
      assignments.set(blockIndex, exactIndex);
      usedGroups.add(exactIndex);
    }
  });

  if (blocks.length === groups.length) {
    blocks.forEach((_block, blockIndex) => {
      if (assignments.has(blockIndex) || usedGroups.has(blockIndex)) return;
      assignments.set(blockIndex, blockIndex);
      usedGroups.add(blockIndex);
    });
  }

  const resolved = [];
  const unresolved = [];
  blocks.forEach((block, blockIndex) => {
    const groupIndex = assignments.get(blockIndex);
    if (groupIndex == null) {
      unresolved.push(...block.episodes);
      return;
    }
    const mapped = mapBlock(block, groups[groupIndex], armLayout);
    resolved.push(...mapped.resolved);
    unresolved.push(...mapped.unresolved);
  });

  // Deduplicate by ARM episodeId: multiple providers may map to the same ARM episode
  const seen = new Set();
  const unique = resolved.filter(episode => {
    const id = episode.episodeId;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return { episodes: unique, unresolved };
}

