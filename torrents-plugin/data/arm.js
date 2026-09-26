import { PotokSDK } from 'potok-sdk';
import { parseJson } from '../utils/http.js';

function layoutUrl(workId) {
  return `/api/arm/v1/works/${encodeURIComponent(workId)}/layout?locale=${encodeURIComponent(PotokSDK.i18n.locale || 'ru-RU')}`;
}

// The work summary (id/title/titles) only exists embedded in the layout body — the old
// standalone /works/{id} read model is gone from the v1 surface.
export async function loadArmWork(context) {
  if (!context.workId) return null;
  if (context.armWork?.id === context.workId) return context.armWork;
  try {
    const response = await PotokSDK.http.get(layoutUrl(context.workId), undefined, 10_000);
    const body = response?.status === 200 ? parseJson(response) : null;
    return body?.work?.id === context.workId ? body.work : null;
  } catch {
    return null;
  }
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
