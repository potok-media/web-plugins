import { defineSource } from './defineSource.js';

export const animego = defineSource({
  id: 'animego',
  name: 'AnimeGo',
  capabilities: { movies: true, series: true },
});
