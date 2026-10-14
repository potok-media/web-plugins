export function buildTorrentSearchRequest(query, originalTitle) {
  return {
    query: query.title,
    title: query.title,
    originalTitle: originalTitle || undefined,
    englishTitle: originalTitle || undefined,
    aliases: [...new Set([query.title, query.originalTitle, query.englishTitle, ...(query.searchAliases || [])]
      .filter((title) => typeof title === "string" && title.trim()).map((title) => title.trim()))],
    year: Number.isInteger(Number(query.year)) && Number(query.year) > 0 ? String(query.year) : undefined,
    mediaType: query.type === "tv" ? "tv" : "movie",
    workId: query.workId || undefined,
    forceSearch: !!query.forceSearch,
  };
}
