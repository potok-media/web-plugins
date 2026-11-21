import { defineSource } from './defineSource.js';

export const rutubemovie = defineSource({
  id: 'rutubemovie',
  name: 'RUTUBE',
  category: 'movies',
  capabilities: { movies: true, series: false },
});
