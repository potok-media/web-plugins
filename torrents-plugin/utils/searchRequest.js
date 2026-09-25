import { positiveId } from "./armMetadata.js";

export function buildTorrentSearchRequest(query, originalTitle) {
  return {
    query: query.title,
    title: query.title,
    originalTitle: originalTitle || undefined,
    englishTitle: originalTitle || undefined,
    mediaType: query.type === "tv" ? "tv" : "movie",
    id: positiveId(query.tmdbId),
    workId: query.workId || undefined,
    forceSearch: !!query.forceSearch,
  };
}
