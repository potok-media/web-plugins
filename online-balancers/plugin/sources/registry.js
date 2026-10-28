import { aniliberty } from './aniliberty.js';
import { animego } from './animego.js';
import { kodik } from './kodik.js';
import { videohub } from './videohub.js';
import { leproduction } from './leproduction.js';
import { veoveo } from './veoveo.js';
import { alloha } from './alloha.js';
import { kinopub } from './kinopub.js';
import { rezka } from './rezka.js';

export function createSourceRegistry(sources) {
  const ordered = [...sources];
  const byId = new Map();
  for (const source of ordered) {
    if (byId.has(source.id)) throw new Error(`Duplicate online source '${source.id}'`);
    byId.set(source.id, source);
  }
  return Object.freeze({
    all: Object.freeze(ordered),
    ids: Object.freeze(ordered.map(source => source.id)),
    free: Object.freeze(ordered.filter(source => source.access === 'free')),
    accounts: Object.freeze(ordered.filter(source => source.access === 'account')),
    get(id) { return byId.get(String(id || '')); },
    has(id) { return byId.has(String(id || '')); },
  });
}

export const sourceRegistry = createSourceRegistry([
  aniliberty,
  kodik,
  animego,
  videohub,
  leproduction,
  veoveo,
  alloha,
  kinopub,
  rezka,
]);
