import { VStack } from '../sdk.js';
import { isBrowsing } from '../navigation/routing.js';
import { buildPickerModal } from '../resolve/picker.js';
import { toolbar } from './toolbar.js';
import { buildCollections } from './collections.js';
import { buildCatalogResults } from './catalogView.js';

export function buildLayout() {
  const children = [
    toolbar(),
    isBrowsing() ? buildCatalogResults() : buildCollections(),
  ];
  const picker = buildPickerModal();
  if (picker) children.push(picker);
  return VStack().id('shiki-root').spacing(20).children(children);
}