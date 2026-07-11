import { PotokSDK } from 'potok-sdk';
import { RESOLVE_HUD_MS } from '../constants.js';
import { t } from '../sdk.js';
import { state } from '../state.js';
import { getCard } from '../data/cardMeta.js';
import { resolveTmdbOpen, hasCachedTmdb } from '../shikimori.js';
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