import { defineSource } from './defineSource.js';

export const veoveo = defineSource({
  id: 'veoveo',
  name: 'VeoVeo',
  category: 'movies',
  capabilities: { movies: true, series: true },
});
