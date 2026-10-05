// Canonical file overrides (file_map armTarget) applied over the graph layout by the
// consumer: the SearchEngine owns the storage and the contract, the Gateway never sees
// overrides. A pin fixes exactly its file at the target episode; an anchor fixes itself and
// walks the layout playback order forward across its scope (or, without one, across the rest
// of the torrent). A target pointing at another work or at an episode the layout does not
// have is skipped — the file keeps whatever the Gateway resolution answered; an older
// numeric assignment is never revived.
export function applyCanonicalOverrides(bindings, orderedFiles, fileMap, layout, workId) {
  const placements = [];
  const byKey = new Map();
  for (const group of layout?.groups || []) {
    for (const episode of group.episodes || []) {
      const placement = { entryId: group.id, episodeId: episode.id, rank: placements.length };
      placements.push(placement);
      byKey.set(`${group.id}/${episode.id}`, placement);
    }
  }
  if (placements.length === 0) return bindings || [];

  const files = (orderedFiles || []).map((file, index) => ({ id: String(file.id), index }));
  const byFileId = new Map((bindings || []).map((binding) => [String(binding.fileId), binding]));

  const overrideBinding = (fileId, placement, method) => ({
    fileId: String(fileId),
    state: "resolved",
    entryId: placement.entryId,
    episodeId: placement.episodeId,
    confidence: 1,
    method,
    evidence: null,
    targets: [{ entryId: placement.entryId, episodeId: placement.episodeId }],
    alternatives: [],
  });

  for (const file of files) {
    const saved = fileMap?.[file.id];
    const target = saved?.armTarget;
    if (!target || !workId || target.workId !== workId) continue;
    const anchor = byKey.get(`${target.entryId}/${target.episodeId}`);
    if (!anchor) continue;

    if (saved.mode === "pin") {
      byFileId.set(file.id, overrideBinding(file.id, anchor, "override-pin"));
      continue;
    }

    const scopeIds = Array.isArray(saved.scopeFileIds) && saved.scopeFileIds.length > 0
      ? saved.scopeFileIds.map(String)
      : files.slice(file.index).map((entry) => entry.id);
    scopeIds.forEach((scopeId, position) => {
      const placement = placements[anchor.rank + position];
      if (!placement) return;
      byFileId.set(scopeId, overrideBinding(scopeId, placement,
        position === 0 ? "override-anchor" : "override-continuity"));
    });
  }

  return files.map((file) => byFileId.get(file.id)).filter(Boolean)
    .concat([...byFileId.values()].filter((binding) => !files.some((file) => String(binding.fileId) === String(file.id))));
}
