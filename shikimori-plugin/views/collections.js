import { state } from '../state.js';
import { SHELVES } from '../constants.js';
import { shelfSee } from '../data/shelves.js';
import { navigateFilters } from '../navigation/routing.js';
import { openItem } from '../resolve/openItem.js';
import {
  VStack, Scroller, ContentRow, TopTenRow, Skeleton, t,
} from '../sdk.js';

function shelfSkeleton() {
  return VStack().spacing(12).children([
    Skeleton().height('1.25rem').width('12rem').rounded('0.5rem'),
    Scroller().orientation('horizontal').spacing(16).children(
      [0, 1, 2, 3, 4, 5].map(() => Skeleton().width('10rem').height('15rem').rounded('0.75rem')),
    ),
  ]);
}

export function buildCollections() {
  const children = [];
  SHELVES.forEach((s) => {
    const items = state.shelves[s.id];
    if (items === undefined) {
      children.push(shelfSkeleton());
      return;
    }
    if (!items.length) return;
    const Row = s.top ? TopTenRow : ContentRow;
    children.push(
      Row().id(`shiki-${s.id}`).title(t(s.key)).items(items).onCardClick(openItem)
        .seeAllLabel(t('seeAll')).onSeeAllClick(() => navigateFilters(shelfSee(s))),
    );
  });
  return VStack().spacing(24).children(children);
}