import { state } from '../state.js';
import { loadCatalog } from '../data/catalog.js';
import { openItem } from '../resolve/openItem.js';
import {
  HStack, PosterGrid, Skeleton, EmptyState, t,
} from '../sdk.js';

function catalogSkeletonGrid() {
  return HStack().spacing(16).children(
    [0, 1, 2, 3, 4, 5].map(() => Skeleton().width('10rem').height('15rem').rounded('0.75rem')),
  );
}

export function buildCatalogResults() {
  if (state.catLoading) return catalogSkeletonGrid();
  if (!state.items.length) {
    return EmptyState().icon('search-x').title(t('empty')).description(t('emptyHint'));
  }

  const grid = PosterGrid().id('shiki-grid').items(state.items).onCardClick(openItem);
  if (state.hasMore) grid.onLoadMore(() => loadCatalog(false));
  return grid;
}