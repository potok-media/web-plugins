import { anidub } from './anidub.js';
import { aniliberty } from './aniliberty.js';
import { animevost } from './animevost.js';
import { animego } from './animego.js';
import { animeon } from './animeon.js';
import { animelib } from './animelib.js';
import { kodik } from './kodik.js';
import { lordfilm } from './lordfilm.js';
import { videohub } from './videohub.js';
import { veoveo } from './veoveo.js';
import { alloha } from './alloha.js';
import { filmix } from './filmix.js';
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
  anidub,
  aniliberty,
  animevost,
  kodik,
  lordfilm,
  animego,
  videohub,
  animeon,
  animelib,
  veoveo,
  alloha,
  filmix,
  kinopub,
  rezka,
]);
