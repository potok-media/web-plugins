import { normalizeGroupTitle, titleAliases } from './grouping.js';

function languageCode(value) {
  return String(value || '').toLocaleLowerCase().split(/[-_]/u, 1)[0];
}

function entryTitle(entry, locale) {
  const titles = entry?.localizedTitles || [];
  const language = languageCode(locale);
  return titles.find(item => languageCode(item.language) === language)?.value
    || titles[0]?.value
    || null;
}

function entryOriginalTitle(entry, locale) {
  const titles = entry?.localizedTitles || [];
  const language = languageCode(locale);
  return titles.find(item => languageCode(item.language) !== language)?.value
    || titles[0]?.value
    || null;
}

function entryAliases(entry) {
  return new Set((entry?.localizedTitles || [])
    .map(item => normalizeGroupTitle(item?.value))
    .filter(Boolean));
}

function armMediaType(kind) {
  return kind === 'movie' ? 'movie' : 'tv';
}

function sourceMatchesEntryType(source, entry) {
  return !source?.mediaType || source.mediaType === armMediaType(entry?.kind);
}

function entryYear(entry) {
  const seasonYear = Number(entry?.displayMetadata?.seasonYear);
  if (Number.isInteger(seasonYear)) return seasonYear;
  const startYear = Number.parseInt(String(entry?.displayMetadata?.startDate || '').slice(0, 4), 10);
  return Number.isInteger(startYear) ? startYear : null;
}

function preferExactYear(matches, source) {
  const sourceYear = Number(source?.year);
  if (!Number.isInteger(sourceYear)) return matches;
  const exact = matches.filter(candidate => entryYear(candidate.entry) === sourceYear);
  return exact.length ? exact : matches;
}

async function resolveWorkId(arm, context) {
  if (context?.workId) return context.workId;
  if (!context?.tmdbId || !arm?.resolveWork) return null;
  const resolved = await arm.resolveWork({
    provider: 'tmdb',
    entityKind: context.type === 'movie' ? 'movie' : 'tv',
    value: String(context.tmdbId),
  });
  return resolved?.workId || null;
}

function tokenCount(value) {
  return String(value || '').split(' ').length;
}

// A source title that is a suffix of the ARM entry title still identifies that entry: the
// normalized source alias is contained in the normalized entry title ("TYBW — Conflict" inside
// "Bleach: TYBW — Conflict"), which plain alias equality misses. Reverse containment is
// deliberately NOT used: a longer source title may merely carry the franchise prefix and would
// wrongly bind the parent entry. Guarded by a minimum token count (a bare franchise word binds
// nothing) and by candidate uniqueness — an ambiguous containment binds nothing.
function containedMatches(aliases, entries) {
  return entries.filter(({ aliases: entryAliases }) =>
    aliases.some(alias =>
      tokenCount(alias) >= 2 && [...entryAliases].some(entryAlias =>
        entryAlias !== alias && entryAlias.includes(alias))));
}

export async function castSourcesToArmEntries({ arm, context = {}, sources = [], locale = null }) {
  if (!arm?.getEntries) return { items: [], unresolvedItems: [...sources], workId: null };
  const workId = await resolveWorkId(arm, context);
  if (!workId) {
    return {
      items: [],
      unresolvedItems: [...sources],
      workId: null,
    };
  }

  const requestedLocale = locale || context.locale || 'ru';
  const response = await arm.getEntries(workId, { locale: requestedLocale });
  const entries = (response?.entries || [])
    .map(entry => ({ entry, aliases: entryAliases(entry) }));
  const items = [];
  const unresolvedItems = [];

  for (const source of sources) {
    const aliases = titleAliases(source);
    const compatibleEntries = entries.filter(candidate => sourceMatchesEntryType(source, candidate.entry));
    let matches = compatibleEntries.filter(candidate =>
      aliases.some(alias => candidate.aliases.has(alias)));
    matches = preferExactYear(matches, source);
    if (matches.length !== 1) {
      const contained = preferExactYear(containedMatches(aliases, compatibleEntries), source);
      matches = contained.length === 1 ? contained : [];
    }
    if (matches.length === 1) {
      const entry = matches[0].entry;
      items.push({
        ...source,
        workId,
        entryId: entry.entryId,
        armTitle: entryTitle(entry, requestedLocale) || source.title,
        armOriginalTitle: entryOriginalTitle(entry, requestedLocale),
        armKind: entry.kind,
        armNumber: entry.number,
        armSortPosition: entry.sortPosition,
        armTmdb: entry.tmdb || null,
        resolutionState: 'resolved',
      });
    } else {
      // Casting only adds metadata — uncast sources stay in the output (as unresolvedItems),
      // the online page never hides a source the providers returned.
      unresolvedItems.push(source);
    }
  }

  return { items, unresolvedItems, workId };
}
