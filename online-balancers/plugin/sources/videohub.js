import { defineSource } from './defineSource.js';

export const videohub = defineSource({
  id: 'videohub',
  name: 'VideoHUB',
  category: 'movies',
  capabilities: { movies: true, series: true },
});
