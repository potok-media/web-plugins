import { defineSource } from './defineSource.js';

export const leproduction = defineSource({
  id: 'leproduction',
  name: 'LeProduction',
  category: 'movies',
  capabilities: { movies: true, series: true },
});
