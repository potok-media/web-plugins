import { PotokSDK } from 'potok-sdk';

export function runtimeConfig() {
  return PotokSDK.runtime.context?.config || {};
}
