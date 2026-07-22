import { TorrentParser } from '../utils/parser.js';

// External (sidecar) track matching for "ext" releases: dub audio / subtitle files that live as SEPARATE files
// in the torrent (folders next to the .mkv) instead of muxed in. The backend returns them (audioFiles /
// subtitleFiles) with their true 1-based torrent index; here we pair each to a video file. The matched indices
// ride the HLS/metadata URL (?xa=/?xs=) and the backend renders them into audio renditions / subtitle tracks.
//
// PRIMARY match = filename STEM (basename minus extension). "ext" releases name each sidecar IDENTICALLY to its
// video (e.g. "…- 17.mkv" ↔ "Deep Sound/…- 17.mka"), so the stem is a perfect, collision-proof key — crucially
// it distinguishes "- 17" from a fractional special "- 17.5" (parsed-episode matching collapses 17.5→17 and
// would steal ep17's dub). FALLBACK = parsed (season, episode), used ONLY when stem matching finds nothing at
// all (a release whose sidecars are named differently from the video); fractional specials are excluded there
// so they can never steal an integer episode's track.

function basename(pathOrName) {
  return String(pathOrName || '').split('/').pop() || '';
}

// normStem: basename minus a trailing extension, lowercased and whitespace-collapsed. Video ".mkv" and sidecar
// ".mka"/".ass" of the same episode differ only by extension → identical stem.
function normStem(pathOrName) {
  const stem = basename(pathOrName).replace(/\.[a-z0-9]{1,5}$/i, '');
  return stem.toLowerCase().replace(/\s+/g, ' ').trim();
}

// hasFractionalEpisode mirrors the parser's fractional-special rule ("- 24.5") so those files are kept out of
// the integer-episode fallback index (anchored to the "- N.M" slot so it never fires on "[5.1]" audio tags).
function hasFractionalEpisode(pathOrName) {
  return /[\s._]-\s*\d{1,3}\.\d+(?=[\s._([]|$)/.test(basename(pathOrName));
}

function fileStem(file) {
  return normStem(file.path || file.title || '');
}

function episodeKey(season, episode) {
  return `${season === undefined ? '_' : season}:${episode === undefined ? '_' : episode}`;
}

function parseEp(file, context, stream, seasons) {
  let filePath = file.path || file.title || '';
  if (!filePath.includes('/') && stream.title) filePath = `${stream.title}/${filePath}`;
  return TorrentParser.parseEpisode(filePath, context.type, context.type === 'tv' ? seasons : undefined);
}

// Attach matched external (sidecar) dub/subtitle torrent indices onto each video file as `externalTracks`
// ({audio,subs}). Returns cleanedFiles unchanged when there are no sidecars.
export function attachExternalTracks(cleanedFiles, audioFiles, subtitleFiles, context, stream, seasons) {
  if ((audioFiles || []).length === 0 && (subtitleFiles || []).length === 0) return cleanedFiles;

  // --- primary: stem index (identical-name releases) ---
  const stemIndex = new Map(); // stem → {audio:[], subs:[]}
  const addStem = (files, kind) => {
    for (const f of files || []) {
      const s = fileStem(f);
      if (!s) continue;
      let e = stemIndex.get(s);
      if (!e) { e = { audio: [], subs: [] }; stemIndex.set(s, e); }
      e[kind].push(String(f.id));
    }
  };
  addStem(audioFiles, 'audio');
  addStem(subtitleFiles, 'subs');

  const byStem = cleanedFiles.map((f) => stemIndex.get(fileStem(f)));
  const anyStemMatch = byStem.some((m) => m && (m.audio.length || m.subs.length));

  if (anyStemMatch) {
    return cleanedFiles.map((f, i) => ({ ...f, externalTracks: byStem[i] || { audio: [], subs: [] } }));
  }

  // --- fallback: parsed (season, episode), fractional specials excluded (they'd steal an integer episode) ---
  const epIndex = new Map();
  const addEp = (files, kind) => {
    for (const f of files || []) {
      if (hasFractionalEpisode(f.path || f.title)) continue;
      const p = parseEp(f, context, stream, seasons);
      if (p.episode === undefined) continue; // no confident episode → don't guess
      const key = episodeKey(p.season, p.episode);
      let e = epIndex.get(key);
      if (!e) { e = { audio: [], subs: [] }; epIndex.set(key, e); }
      e[kind].push(String(f.id));
    }
  };
  addEp(audioFiles, 'audio');
  addEp(subtitleFiles, 'subs');

  // Single-video torrent (movie / one file): take ALL sidecars regardless of how names parse.
  if (cleanedFiles.length === 1) {
    const all = {
      audio: (audioFiles || []).map((f) => String(f.id)),
      subs: (subtitleFiles || []).map((f) => String(f.id)),
    };
    return [{ ...cleanedFiles[0], externalTracks: all }];
  }

  return cleanedFiles.map((f) => {
    if (hasFractionalEpisode(f.path || f.fileName || f.title)) {
      return { ...f, externalTracks: { audio: [], subs: [] } };
    }
    const ext = epIndex.get(episodeKey(f.rawSeason, f.rawEpisode)) || { audio: [], subs: [] };
    return { ...f, externalTracks: ext };
  });
}
