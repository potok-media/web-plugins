import { PotokSDK } from 'potok-sdk';
import { parseJson } from '../utils/http.js';

export async function loadArmWork(context) {
  if (!context.workId) return null;
  if (context.armWork?.id === context.workId) return context.armWork;
  try {
    const response = await PotokSDK.http.get(`/api/arm/v1/works/${encodeURIComponent(context.workId)}`, undefined, 10_000);
    const body = response?.status === 200 ? parseJson(response) : null;
    return body?.work?.id === context.workId ? body.work : null;
  } catch {
    return null;
  }
}

export async function loadArmLayout(resolution) {
  if (!resolution?.workId || !resolution.orderingId) return null;
  try {
    const url = `/api/arm/v1/works/${encodeURIComponent(resolution.workId)}/layout?ordering=${encodeURIComponent(resolution.orderingId)}&locale=${encodeURIComponent(PotokSDK.i18n.locale || 'ru-RU')}`;
    const response = await PotokSDK.http.get(url, undefined, 10_000);
    return response?.status === 200 ? parseJson(response) : null;
  } catch {
    return null;
  }
}
