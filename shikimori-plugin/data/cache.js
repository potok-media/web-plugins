import { PotokSDK } from 'potok-sdk';

export async function readCache(key, ttlMs) {
  try {
    const raw = await PotokSDK.storage.local.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ts !== 'number' || Date.now() - parsed.ts > ttlMs) return null;
    return parsed.data;
  } catch (e) {
    return null;
  }
}

export async function writeCache(key, data) {
  try {
    await PotokSDK.storage.local.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch (e) { /* storage full/unavailable → refetch next time */ }
}