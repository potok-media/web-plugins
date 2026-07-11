import './i18n.js';
import { registerSlots, wireRendering } from './register.js';
import { bootstrap } from './bootstrap.js';

registerSlots();
wireRendering();
bootstrap();