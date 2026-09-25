export function textValue(text) {
  return typeof text === "string" ? text : text?.value || "";
}

export function positiveId(value) {
  if (value == null || value === "") return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export function tmdbWorkId(work, mediaType, preferred) {
  const ids = (work?.providerReferences || [])
    .filter((ref) => ref.provider === "tmdb" && ref.entityKind === (mediaType === "tv" ? "tv" : "movie"))
    .map((ref) => positiveId(ref.value)).filter((id) => id !== undefined);
  const explicit = positiveId(preferred);
  if (explicit && (ids.length === 0 || ids.includes(explicit))) return explicit;
  const unique = [...new Set(ids)];
  return unique.length === 1 ? unique[0] : undefined;
}

// Choose two useful search strings; the SearchEngine concatenates these for trackers.
// Keep every published alias separately for relevance matching rather than bloating the query.
export function armSearchContext(query, work) {
  if (!work || work.id !== query.workId) return query;
  const names = (work.names || []).filter((name) => typeof name.value === "string" && name.value.trim());
  const ru = names.find((name) => name.locale?.toLowerCase().startsWith("ru") && name.role !== "short")?.value;
  const title = ru || textValue(work.displayTitle) || query.title;
  const different = (name) => name.value.trim().toLowerCase() !== String(title).trim().toLowerCase();
  const latin = names.find((name) => name.locale?.toLowerCase().startsWith("en") && different(name))
    || names.find((name) => name.role === "romanized" && different(name))
    || names.find((name) => name.role === "original" && different(name));
  return {
    ...query,
    title,
    originalTitle: latin?.value || query.originalTitle,
    englishTitle: latin?.value || query.englishTitle,
    tmdbId: tmdbWorkId(work, query.type, query.tmdbId),
    searchAliases: [...new Set([query.title, query.originalTitle, query.englishTitle, ...names.map((name) => name.value)].filter(Boolean))],
  };
}

function tmdbCoordinates(episode, tmdbId) {
  const coordinates = (episode.providerReferences || []).flatMap((ref) => {
    if (ref.provider !== "tmdb" || ref.entityKind !== "tv-episode") return [];
    const match = String(ref.value).match(/^(\d+)\/(\d+)\/(\d+)$/);
    if (!match || (tmdbId != null && Number(match[1]) !== Number(tmdbId))) return [];
    return [{ tmdbId: Number(match[1]), season: Number(match[2]), episode: Number(match[3]) }];
  });
  const unique = [...new Map(coordinates.map((value) => [`${value.tmdbId}/${value.season}/${value.episode}`, value])).values()];
  return unique.length === 1 ? unique[0] : null;
}

export function applyArmMetadata(files, resolution, layout, tmdbId) {
  if (!resolution?.workId || !layout || layout.workId !== resolution.workId
    || layout.ordering?.id !== resolution.orderingId
    || (resolution.graphVersion && layout.graphVersion !== resolution.graphVersion)) return files;

  const placements = new Map();
  let rank = 0;
  for (const group of [...(layout.groups || [])].sort((a, b) => (a.sortPosition ?? 0) - (b.sortPosition ?? 0))) {
    for (const episode of [...(group.episodes || [])].sort((a, b) => (a.sortPosition ?? 0) - (b.sortPosition ?? 0))) {
      placements.set(`${group.id}/${episode.id}`, { group, episode, rank: rank++ });
    }
  }
  const fileRanks = new Map();
  return files.map((file) => {
    if (file.resolutionState !== "resolved" || !file.targets?.length) return file;
    const found = file.targets.map((target) => target.orderingId === layout.ordering.id
      ? placements.get(`${target.groupId}/${target.episodeId}`) : null);
    if (found.some((placement) => !placement)) return file;
    found.sort((a, b) => a.rank - b.rank);
    fileRanks.set(file.id, found[0].rank);
    const { group, episode } = found[0];
    const single = found.length === 1;
    const coordinates = single ? tmdbCoordinates(episode, tmdbId) : null;
    const ordinals = found.map(({ episode: item }) => item.ordinal || String(item.displayEpisodeNumber ?? "")).filter(Boolean);
    const names = found.map(({ episode: item }) => textValue(item.displayTitle)).filter(Boolean);
    return {
      ...file,
      season: coordinates?.season,
      episode: coordinates?.episode,
      groupTitle: textValue(group.displayTitle) || undefined,
      groupKind: group.kind,
      groupDisplayNumber: group.displayNumber ?? undefined,
      displayOrdinal: ordinals.join("–") || undefined,
      title: names.length > 0 ? names.join(" / ") : file.title,
      stillPath: episode.stillPath || file.stillPath,
      airDate: episode.airDate || file.airDate,
      armAnnotation: single ? episode.annotation : undefined,
    };
  // Stable ordering keeps files for the same episode and unmatched files in their original order.
  }).sort((a, b) => (fileRanks.get(a.id) ?? Infinity) - (fileRanks.get(b.id) ?? Infinity));
}
