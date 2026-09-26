export function positiveId(value) {
  if (value == null || value === "") return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

// Choose two useful search strings; the SearchEngine concatenates these for trackers.
// Keep every published title separately for relevance matching rather than bloating the query.
export function armSearchContext(query, work) {
  if (!work || work.id !== query.workId) return query;
  const titles = work.titles || {};
  const published = [titles.ru, work.title, titles.official, titles.en, titles.original]
    .filter((value) => typeof value === "string" && value.trim());
  const title = (typeof titles.ru === "string" && titles.ru.trim()) || work.title || query.title;
  const different = (value) => value.trim().toLowerCase() !== String(title).trim().toLowerCase();
  const latin = [titles.en, titles.original]
    .find((value) => typeof value === "string" && value.trim() && different(value));
  return {
    ...query,
    title,
    originalTitle: latin || query.originalTitle,
    englishTitle: latin || query.englishTitle,
    searchAliases: [...new Set([query.title, query.originalTitle, query.englishTitle, ...published].filter(Boolean))],
  };
}

// Only a validated episode TMDB coordinate may become Trakt season/episode numbers: the show
// must match the context TMDB id (when known) and season/episode must be real integers.
function tmdbCoordinates(episode, tmdbId) {
  const coordinate = episode?.tmdb;
  if (!coordinate) return null;
  const show = positiveId(coordinate.show);
  if (show === undefined || (tmdbId != null && show !== Number(tmdbId))) return null;
  const { season, episode: episodeNumber } = coordinate;
  if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episodeNumber) || episodeNumber < 0) return null;
  return { season, episode: episodeNumber };
}

export function applyArmMetadata(files, resolution, layout, tmdbId) {
  if (!resolution?.workId || !layout || layout.work?.id !== resolution.workId
    || (resolution.graphVersion && layout.graphVersion !== resolution.graphVersion)) return files;

  const placements = new Map();
  let rank = 0;
  for (const group of layout.groups || []) {
    for (const episode of group.episodes || []) {
      placements.set(`${group.id}/${episode.id}`, { group, episode, rank: rank++ });
    }
  }
  const fileRanks = new Map();
  return files.map((file) => {
    if (file.resolutionState !== "resolved" || !file.targets?.length) return file;
    const found = file.targets.map((target) => placements.get(`${target.entryId}/${target.episodeId}`) || null);
    if (found.some((placement) => !placement)) return file;
    found.sort((a, b) => a.rank - b.rank);
    fileRanks.set(file.id, found[0].rank);
    const { group, episode } = found[0];
    const single = found.length === 1;
    const coordinates = single ? tmdbCoordinates(episode, tmdbId) : null;
    const ordinals = found.map(({ episode: item }) => item.number != null ? String(item.number) : "").filter(Boolean);
    const names = found.map(({ episode: item }) => typeof item.title === "string" ? item.title : "").filter(Boolean);
    return {
      ...file,
      season: coordinates?.season,
      episode: coordinates?.episode,
      groupTitle: typeof group.title === "string" && group.title ? group.title : undefined,
      groupKind: group.kind,
      groupDisplayNumber: group.number ?? undefined,
      displayOrdinal: ordinals.join("–") || undefined,
      title: names.length > 0 ? names.join(" / ") : file.title,
      stillPath: episode.stillPath || file.stillPath,
      airDate: episode.airDate || file.airDate,
      filler: single ? episode.filler ?? null : undefined,
    };
  // Stable ordering keeps files for the same episode and unmatched files in their original order.
  }).sort((a, b) => (fileRanks.get(a.id) ?? Infinity) - (fileRanks.get(b.id) ?? Infinity));
}
