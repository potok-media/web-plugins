// Infohash helpers. Kept pure (no I/O) so search/episodes/playback/overrides all derive the hash the same way.

// Normalize an infohash: strip a `urn:btih:` prefix and any trailing magnet params, lowercase.
export function cleanHash(hash) {
  if (!hash) return "";
  return hash.replace(/^urn:btih:/i, "").split("&")[0].trim().toLowerCase();
}

// Recover the infohash from a TorrentGo URL (`.../api/torrents/{40-hex}/...`). getEpisodes bakes the
// authoritative hash into each episode URL, so getPlaybackInfo can recover it even if the host strips the
// custom `torrentHash` field off the episode object.
export function parseHashFromUrl(url) {
  if (!url) return "";
  const m = String(url).match(/\/api\/torrents\/([0-9a-fA-F]{40})\b/);
  return m ? m[1].toLowerCase() : "";
}

// Best-effort hash from a stream object (hash | url | magnet), falling back to the "torrent-id" sentinel the
// override/episode calls used inline.
export function streamHash(stream) {
  return cleanHash((stream && (stream.hash || stream.url || stream.magnet)) || "torrent-id");
}
