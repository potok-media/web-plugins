import { PotokSDK } from 'potok-sdk';
import { parseJson } from '../utils/http.js';

function layoutUrl(workId) {
  return `/api/arm/v1/works/${encodeURIComponent(workId)}/layout?locale=${encodeURIComponent(PotokSDK.i18n.locale || 'ru-RU')}`;
}

export async function loadArmLayout(resolution) {
  if (!resolution?.workId) return null;
  try {
    const response = await PotokSDK.http.get(layoutUrl(resolution.workId), undefined, 10_000);
    return response?.status === 200 ? parseJson(response) : null;
  } catch {
    return null;
  }
}
