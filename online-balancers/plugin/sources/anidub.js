import { defineSource } from './defineSource.js';

export const anidub = defineSource({
  id: 'anidub',
  name: 'AniDUB',
  slow: true,
  category: 'anime',
  capabilities: { movies: true, series: true },
});
