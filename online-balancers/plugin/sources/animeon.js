import { defineSource } from './defineSource.js';

export const animeon = defineSource({
  id: 'animeon',
  name: 'AnimeON',
  category: 'anime',
  capabilities: { movies: true, series: true },
});
