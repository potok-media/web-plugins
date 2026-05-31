import { PotokSDK } from '../sdk.js';
import { VideoDBProvider } from './providers/videodb.js';
import { LiftProvider } from './providers/lift.js';
import { KinotochkaProvider } from './providers/kinotochka.js';

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

// 2. Register a single, unified searchProvider for this plugin
PotokSDK.media.searchProvider("potok-online-balancer", "Модульные Онлайн Источники")
  .onSearch(async (query) => {
    const results = await Promise.all([
      videoDB.search(query).catch(err => { console.error(err); return []; }),
      lift.search(query).catch(err => { console.error(err); return []; }),
      kinotochka.search(query).catch(err => { console.error(err); return []; })
    ]);

    const flatResults = results.flat();

    return flatResults.map((s) => ({
      id: `${s.provider}:${s.id || Math.random()}`,
      title: s.title,
      sizeBytes: s.sizeBytes,
      quality: s.quality === "1080p" ? "1080p" : s.quality === "2160p" || s.quality === "4K" ? "2160p" : s.quality === "720p" ? "720p" : "480p",
      streamUrl: s.url,
      seeders: s.seeders || 0,
      leechers: s.leechers || 0,
      tracker: s.provider === "videodb" ? "VideoDB Cloud" : s.provider === "lift" ? "Lift" : s.provider === "kinotochka" ? "Киноточка" : s.provider,
      sourceName: "Модульные Онлайн Источники",
      translations: s.voice ? [s.voice] : [],
      headers: s.headers
    }));
  });

