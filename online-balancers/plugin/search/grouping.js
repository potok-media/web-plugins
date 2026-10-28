export function normalizeGroupTitle(value) {
  const parts = String(value || '').normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu);
  return parts ? parts.join(' ') : '';
}

export function titleAliases(item) {
  const values = [item.title, item.originalTitle];
  for (const title of [item.title, item.originalTitle]) {
    if (title) values.push(...String(title).split(/\s*[\/|]\s*/u));
  }
  return [...new Set(values.map(normalizeGroupTitle).filter(Boolean))];
}

export function compareQualities(left, right) {
  const leftNumber = Number.parseInt(left, 10) || 0;
  const rightNumber = Number.parseInt(right, 10) || 0;
  return rightNumber - leftNumber || String(left).localeCompare(String(right));
}

export function variantVoice(stream, fallback = '') {
  return fallback || stream?.voice || stream?.provider || '';
}

export function groupSources(items) {
  const groups = [];
  for (const item of items) {
    const aliases = titleAliases(item);
    const mediaType = item.mediaType || 'tv';
    let group = item.entryId
      ? groups.find(candidate => candidate.entryId === item.entryId)
      : groups.find(candidate => {
        const sameType = candidate.mediaType === mediaType;
        const compatibleYear = !candidate.year || !item.year || candidate.year === item.year;
        return sameType && compatibleYear && aliases.some(alias => candidate.aliases.has(alias));
      });

    if (!group) {
      const identity = `${mediaType}:${item.year || 'unknown'}:${aliases[0] || item.id}`;
      group = {
        id: item.entryId ? `arm:${item.entryId}` : `group:${identity}`,
        title: item.armTitle || item.title,
        originalTitle: item.armOriginalTitle || item.originalTitle,
        year: item.year,
        poster: item.poster,
        mediaType,
        workId: item.workId || null,
        entryId: item.entryId || null,
        armKind: item.armKind || null,
        armNumber: item.armNumber ?? null,
        armSortPosition: item.armSortPosition ?? null,
        armTmdb: item.armTmdb || null,
        aliases: new Set(aliases),
        variants: [],
      };
      groups.push(group);
    }

    aliases.forEach(alias => group.aliases.add(alias));
    group.poster ||= item.poster;
    group.year ||= item.year;
    group.originalTitle ||= item.originalTitle;
    group.variants.push(item);
  }

  return groups.map(group => {
    const providers = [...new Set(group.variants.map(item => item.provider).filter(Boolean))];
    const qualities = [...new Set(group.variants.map(item => item.quality).filter(Boolean))]
      .sort(compareQualities);
    const voices = [...new Set(group.variants.map(item => variantVoice(item)).filter(Boolean))]
      .sort((left, right) => String(left).localeCompare(String(right)));
    return { ...group, providers, qualities, voices };
  }).sort((left, right) => {
    const leftArm = left.entryId != null;
    const rightArm = right.entryId != null;
    if (leftArm && rightArm) {
      return (left.armSortPosition ?? Number.MAX_SAFE_INTEGER)
        - (right.armSortPosition ?? Number.MAX_SAFE_INTEGER);
    }
    if (leftArm !== rightArm) return leftArm ? -1 : 1;
    return 0;
  });
}

export function visibleGroups(groups, filters) {
  return groups.filter(group => group.variants.some(item =>
    (filters.provider === 'all' || item.providerId === filters.provider)
    && (filters.quality === 'all' || item.quality === filters.quality)
    && (filters.voice === 'all' || variantVoice(item) === filters.voice)));
}

export function stableCardId(item) {
  const value = item.id;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) || 1;
}
