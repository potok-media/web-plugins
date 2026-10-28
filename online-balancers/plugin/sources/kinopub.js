import { defineSource } from './defineSource.js';

export const kinopub = defineSource({
  id: 'kinopub',
  name: 'KinoWatch (KinoPub)',
  category: 'general',
  access: 'account',
  authMode: 'device-code',
  capabilities: { movies: true, series: true },
});
