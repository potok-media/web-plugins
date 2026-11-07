import { defineSource } from './defineSource.js';

export const filmix = defineSource({
  id: 'filmix',
  name: 'Filmix',
  category: 'general',
  access: 'account',
  authMode: 'device-code',
  capabilities: { movies: true, series: true },
});
