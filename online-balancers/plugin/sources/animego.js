import { defineSource } from './defineSource.js';

export const animego = defineSource({
  id: 'animego',
  name: 'AnimeGo',
  slow: true,
  capabilities: { movies: true, series: true },
});
