import { PotokSDK } from '../sdk.js';
import { VideoDBProvider } from './providers/videodb.js';
import { LiftProvider } from './providers/lift.js';
import { KinotochkaProvider } from './providers/kinotochka.js';
import { registerSettingsSlot } from './slots/settings.js';
import { registerStreamsSlot } from './slots/streams.js';

const videoDB = new VideoDBProvider();
const lift = new LiftProvider();
const kinotochka = new KinotochkaProvider();

// 1. Register main plugin metadata in host
PotokSDK.registerPlugin({
  id: "potok-online-balancer",
  name: "Модульные Онлайн Источники",
  version: "2.0.0",
  description: "Клиентский порт Go-движка онлайн-балансеров (VideoDB, Lift, Киноточка)"
});

// 2. Register lookup provider search engines in host registry
PotokSDK.registerSource({
  id: videoDB.id,
  name: videoDB.name,
  supportedTypes: ["movie", "tv"],
  lookup: (query) => videoDB.search(query)
});

PotokSDK.registerSource({
  id: lift.id,
  name: lift.name,
  supportedTypes: ["movie", "tv"],
  lookup: (query) => lift.search(query)
});

PotokSDK.registerSource({
  id: kinotochka.id,
  name: kinotochka.name,
  supportedTypes: ["movie", "tv"],
  lookup: (query) => kinotochka.search(query)
});

// 3. Register UI Slots
registerSettingsSlot();
registerStreamsSlot(videoDB, lift, kinotochka);
