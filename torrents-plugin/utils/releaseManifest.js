function nullable(value) {
  return value === undefined ? null : value;
}

// The Gateway owns name/path interpretation. Sending a lossy JS parse here would override
// its decimal, range and special-group evidence before canonical matching even begins.
export function buildReleaseManifest({
  releaseId, releaseTitle, workId, orderingId, providerReference, mediaType, files,
  fileOverrides, sectionOverrides,
}) {
  return {
    releaseId: String(releaseId || ""),
    title: String(releaseTitle || ""),
    workId: workId || null,
    orderingId: orderingId || null,
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
    armAnnotation: undefined,
    workId: null,
    episodeId: null,
    episodeIds: [],
    orderingId: null,
    groupId: null,
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
      ? binding.targets.filter((target) => target.episodeId && target.orderingId && target.groupId)
        .map((target) => ({ ...target }))
      : binding.episodeId && binding.groupId && (binding.orderingId || resolution.orderingId)
        ? [{
            episodeId: binding.episodeId,
            orderingId: binding.orderingId || resolution.orderingId,
            groupId: binding.groupId,
            compatibility: binding.compatibility || null,
          }]
        : [];
    const single = targets.length === 1 ? targets[0] : null;
    const sameGroup = targets.length > 0 && targets.every((target) => target.groupId === targets[0].groupId);
    const sameOrdering = targets.length > 0 && targets.every((target) => target.orderingId === targets[0].orderingId);
    return {
      ...clean,
      // ARM display coordinates are not TMDB coordinates. A later metadata projection may
      // fill these from a real tmdb:tv-episode reference, never from binding.compatibility.
      workId: resolution?.workId || null,
      episodeId: single?.episodeId || null,
      episodeIds: targets.map((target) => target.episodeId),
      orderingId: sameOrdering ? targets[0].orderingId : resolution?.orderingId || null,
      groupId: sameGroup ? targets[0].groupId : null,
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
