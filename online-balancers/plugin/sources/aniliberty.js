import { defineSource } from './defineSource.js';

export const aniliberty = defineSource({
  id: 'aniliberty',
  name: 'AniLiberty',
  capabilities: { movies: true, series: true },
});
