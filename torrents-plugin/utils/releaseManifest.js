function nullable(value) {
  return value === undefined ? null : value;
}

// The Gateway owns name/path interpretation. Sending a lossy JS parse here would override
// its decimal, range and special-group evidence before canonical matching even begins.
export function buildReleaseManifest({
  releaseId, releaseTitle, workId, providerReference, mediaType, files,
  fileOverrides, sectionOverrides, entryId,
}) {
  return {
    releaseId: String(releaseId || ""),
    title: String(releaseTitle || ""),
    workId: workId || null,
    entryId: entryId || null,
    providerReference: providerReference || null,
    mediaType: mediaType || null,
    fileOverrides: fileOverrides || {},
    sectionOverrides: sectionOverrides || {},
    files: (files || []).map((file, index) => ({
      fileId: String(file.id),
      order: index,
      path: String(file.path || file.title || ""),
      sizeBytes: nullable(file.sizeBytes),
      durationSeconds: nullable(file.durationSeconds),
      fingerprint: nullable(file.fingerprint),
    })),
  };
}

function clearBinding(file) {
  return {
    ...file,
    // Parser coordinates remain raw evidence until ARM proves a provider projection.
    season: undefined,
    episode: undefined,
    filler: undefined,
    workId: null,
    episodeId: null,
    episodeIds: [],
    entryId: null,
    groupTitle: undefined,
    groupKind: undefined,
    groupDisplayNumber: undefined,
    displayOrdinal: undefined,
    targets: [],
    alternatives: [],
    confidence: 0,
    bindingMethod: null,
    resolutionState: "unresolved",
  };
}

export function applyEpisodeBindings(files, resolution) {
  const byFileId = new Map(
    (resolution?.bindings || []).map((binding) => [String(binding.fileId), binding]),
  );
  return (files || []).map((file) => {
    const clean = clearBinding(file);
    const binding = byFileId.get(String(file.id));
    if (!binding) return clean;

    const state = String(binding.state || "unresolved").toLowerCase();
    const resolved = state === "resolved" && !!resolution?.workId;
    const targets = !resolved ? [] : Array.isArray(binding.targets) && binding.targets.length > 0
      ? binding.targets.filter((target) => target.episodeId && target.entryId)
        .map((target) => ({ entryId: target.entryId, episodeId: target.episodeId }))
      : binding.episodeId && binding.entryId
        ? [{ episodeId: binding.episodeId, entryId: binding.entryId }]
        : [];
    const single = targets.length === 1 ? targets[0] : null;
    const sameEntry = targets.length > 0 && targets.every((target) => target.entryId === targets[0].entryId);
    return {
      ...clean,
      // ARM display coordinates are not TMDB coordinates. A later metadata projection may
      // fill these from the episode's own tmdb coordinate, never from binding evidence.
      workId: resolution?.workId || null,
      episodeId: single?.episodeId || null,
      episodeIds: targets.map((target) => target.episodeId),
      entryId: sameEntry ? targets[0].entryId : null,
      targets,
      resolutionState: resolved && targets.length === 0 ? "unresolved" : state,
      confidence: Number.isFinite(binding.confidence) ? binding.confidence : 0,
      bindingMethod: binding.method || null,
      rawEvidence: binding.evidence || file.rawEvidence || null,
      alternatives: Array.isArray(binding.alternatives) ? binding.alternatives : [],
    };
  });
}

export function rawCompatibilityProjection({ mediaType, parsed, titleSeason }) {
  return {
    season: parsed.season !== undefined ? parsed.season
      : mediaType === "tv" ? (titleSeason > 0 ? titleSeason : undefined) : 0,
    episode: parsed.episode,
  };
}
