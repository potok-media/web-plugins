// Links a torrent release title to the ONE franchise entry it belongs to. The arc name in
// the release title is the primary signal (normalized substring against every title variant
// of every layout entry); a "ТВ-N"/"Season N" marker is only corroboration through the
// entry's own TMDB bridge coordinate, never a standalone rule — release authors number
// seasons their own way. Only a unique confident match is pinned; anything else stays
// unresolved and falls back to the generic ambiguous flow.

const KIND_WORDS = new Set(["specials", "special", "ova", "ona", "movie", "season", "tv", "сезон", "спешлы"]);

export function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleVariants(group) {
  const variants = [];
  const push = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    // Full title plus arc parts ("Show: Arc" / "Show - Arc"): the franchise base name and
    // the arc-only suffix are separate candidates.
    for (const part of [raw, ...raw.split(/:|\s+-\s+|—|–/)]) {
      const normalized = normalizeTitle(part);
      if (normalized.length >= 6 && !KIND_WORDS.has(normalized)) variants.push(normalized);
    }
  };
  push(group?.title);
  const titles = group?.titles || {};
  push(titles.official);
  push(titles.en);
  push(titles.ru);
  push(titles.original);
  return [...new Set(variants)];
}

function bestMatch(releaseTitleNormalized, group) {
  let best = "";
  for (const variant of titleVariants(group)) {
    if (releaseTitleNormalized.includes(variant) && variant.length > best.length) best = variant;
  }
  return best;
}

// A variant that strictly nests inside another entry's title is the franchise base name —
// it matches every release of the franchise and must never pin anything on its own.
function isFranchiseBaseName(variant, leader, groups) {
  return groups.some((group) =>
    group.id !== leader.id
    && titleVariants(group).some((other) => other.length > variant.length && other.includes(variant)));
}

function corroboratesSeason(group, season, tmdbId) {
  if (season == null || tmdbId == null || group.tmdbShow == null || group.tmdbSeason == null) return false;
  return Number(group.tmdbShow) === Number(tmdbId) && Number(group.tmdbSeason) === Number(season);
}

function parseSeasonMarker(releaseTitle) {
  const text = String(releaseTitle || "");
  // JS \b ignores Cyrillic, so boundaries are spelled out explicitly.
  let match = text.match(/(?:^|[^a-zа-я0-9])(?:тв|tv|season)[\s\-:]*(\d{1,2})(?![0-9a-z])/i);
  if (!match) match = text.match(/(?:^|[\s(\[])s(\d{1,2})(?![0-9a-z])/i);
  return match ? Number(match[1]) : null;
}

export function resolveEntryHint(releaseTitle, layout, tmdbId) {
  if (!layout?.groups?.length) return null;
  const normalized = normalizeTitle(releaseTitle);
  if (!normalized) return null;

  // Longest matched variant wins: a bare franchise title ("Kimetsu no Yaiba") matches
  // every release of the franchise, the full arc title must beat it.
  const scored = layout.groups
    .map((group) => ({ group, variant: bestMatch(normalized, group) }))
    .filter((item) => item.variant.length > 0);
  if (scored.length === 0) return null;
  const max = Math.max(...scored.map((item) => item.variant.length));
  const leaders = scored.filter((item) => item.variant.length === max);

  if (leaders.length === 1 && !isFranchiseBaseName(leaders[0].variant, leaders[0].group, layout.groups))
    return leaders[0].group.id;

  // Tie or franchise-base-name-only: the "ТВ-N"/"Season N" marker may corroborate exactly
  // one entry through its own TMDB bridge coordinate; otherwise nothing is pinned.
  const season = parseSeasonMarker(releaseTitle);
  const narrowed = scored
    .map((item) => item.group)
    .filter((group) => corroboratesSeason(group, season, tmdbId));
  return narrowed.length === 1 ? narrowed[0].id : null;
}
