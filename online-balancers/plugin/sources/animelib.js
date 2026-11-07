import { defineSource } from './defineSource.js';

export const animelib = defineSource({
  id: 'animelib',
  name: 'AnimeLib',
  category: 'anime',
  adult: true,
  capabilities: { movies: true, series: true },
});
