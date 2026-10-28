import { defineSource } from './defineSource.js';

export const alloha = defineSource({
  id: 'alloha',
  name: 'Alloha',
  category: 'general',
  access: 'account',
  authMode: 'tokens',
  capabilities: { movies: true, series: true },
});
