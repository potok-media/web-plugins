import { PotokSDK } from 'potok-sdk';
import { RESOLVE_HUD_MS } from '../constants.js';
import { t } from '../sdk.js';
import { state } from '../state.js';
import { getCard } from '../data/cardMeta.js';
import {
  cacheTmdbChoice, hasCachedTmdb, resolveCachedTmdb, resolveTmdbOpen,
} from '../shikimori.js';
import { resolveArmOpen } from './armNav.js';
import { navigateToTmdb, showNotFound } from './tmdbNav.js';

let opening = false;

export async function openItem(item) {
  if (!item || item.id == null || opening) return;
  const meta = getCard(item.id);
  if (!meta) return;

  opening = true;
  try {
    const cached = await hasCachedTmdb(meta.shikiId);
    if (!cached) {
      PotokSDK.ui.showHUD('info', t('resolving'), { durationMs: RESOLVE_HUD_MS });
    }

    // 1) A hit the user already opened or picked (re-verified against TMDB).
    const cachedHit = await resolveCachedTmdb(meta);
    if (cachedHit) {
      navigateToTmdb(cachedHit, meta.mediaType);
      return;
    }

    // 2) Primary: our ARM graph — malId → work → layout → the bridged TMDB coordinate.
    try {
      const armHit = await resolveArmOpen(meta);
      if (armHit) {
        await cacheTmdbChoice(meta.shikiId, armHit);
        navigateToTmdb(armHit, meta.mediaType);
        return;
      }
    } catch (e) { /* legacy fallback below */ }

    // 3) Fallback: TMDB title search (+ picker on ambiguity) for titles the graph misses.
    let result;
    try {
      result = await resolveTmdbOpen(meta);
    } catch (e) {
      showNotFound();
      return;
    }

    if (result.kind === 'direct' && result.hit) {
      navigateToTmdb(result.hit, meta.mediaType);
    } else if (result.kind === 'choose' && result.candidates.length) {
      state.pickerShikiId = meta.shikiId;
      state.pickerItems = result.candidates;
      state.pickerOpen = true;
    } else {
      showNotFound();
    }
  } finally {
    opening = false;
  }
}
