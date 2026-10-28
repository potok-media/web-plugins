import { defineSource } from './defineSource.js';

export const kodik = defineSource({
  id: 'kodik',
  name: 'Kodik',
  capabilities: { movies: true, series: true },
});
