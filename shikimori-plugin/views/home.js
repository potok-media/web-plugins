import { PotokSDK } from 'potok-sdk';
import { state } from '../state.js';
import { PAGE_PATH, HOME_ID } from '../constants.js';
import { openItem } from '../resolve/openItem.js';
import { buildPickerModal } from '../resolve/picker.js';
import { VStack, ContentRow, t } from '../sdk.js';

export function homeRowLayout() {
  const items = (state.shelves.popular || []).slice(0, 12);
  if (!items.length && !state.pickerOpen) return VStack().id('shiki-home-empty');

  const children = [];
  if (items.length) {
    children.push(
      ContentRow().id('shiki-home-row').title(t('homeRow')).items(items)
        .seeAllLabel(t('seeAll')).onCardClick(openItem)
        .onSeeAllClick(() => PotokSDK.ui.navigateTo(PAGE_PATH)),
    );
  }

  const picker = buildPickerModal();
  if (picker) children.push(picker);
  return VStack().id('shiki-home-wrap').children(children);
}

export function renderHomeContribution() {
  PotokSDK.ui.render(homeRowLayout(), HOME_ID);
}