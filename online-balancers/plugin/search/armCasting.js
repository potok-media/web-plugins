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

export async function castSourcesToArmEntries({ arm, context = {}, sources = [], locale = null }) {
  if (!arm?.getEntries) return { items: sources, unresolvedItems: [], workId: null };
  const workId = await resolveWorkId(arm, context);
  if (!workId) {
    return {
      items: sources,
      unresolvedItems: [],
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
    const matches = entries.filter(candidate =>
      aliases.some(alias => candidate.aliases.has(alias)));
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
      items.push(source);
    }
  }

  return { items, unresolvedItems, workId };
}
