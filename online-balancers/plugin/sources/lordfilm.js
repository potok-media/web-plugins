import { defineSource } from './defineSource.js';

export const lordfilm = defineSource({
  id: 'lordfilm',
  name: 'LordFilm',
  slow: true,
  category: 'movies',
  capabilities: { movies: true, series: true },
});
