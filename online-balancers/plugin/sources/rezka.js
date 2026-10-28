import { defineSource } from './defineSource.js';

export const rezka = defineSource({
  id: 'rezka',
  name: 'Rezka',
  category: 'general',
  access: 'account',
  authMode: 'session',
  capabilities: { movies: true, series: true },
});
