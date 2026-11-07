import { defineSource } from './defineSource.js';

export const animevost = defineSource({
  id: 'animevost',
  name: 'Animevost',
  slow: true,
  category: 'anime',
  capabilities: { movies: true, series: true },
});
