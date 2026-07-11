import { state } from './state.js';
import { loadGenres } from './data/genres.js';
import { loadCollections } from './data/shelves.js';
import { renderHomeContribution } from './views/home.js';

export async function bootstrap() {
  state.genres = await loadGenres();
  await loadCollections(renderHomeContribution);
}