import { PotokSDK } from 'potok-sdk';
import { t } from '../sdk.js';

export function navigateToTmdb(hit, fallbackMediaType) {
  if (!hit || hit.id == null) return;
  PotokSDK.ui.navigateTo(`/media/${hit.mediaType || fallbackMediaType}/${hit.id}`);
}

export function showNotFound() {
  PotokSDK.ui.showHUD('warning', t('notFound'));
}