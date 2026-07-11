import { state } from '../state.js';
import {
  VStack, Scroller, PosterGrid, Text, Heading, Modal, t,
} from '../sdk.js';
import { cacheTmdbChoice, verifyTmdbHit } from '../shikimori.js';
import { navigateToTmdb, showNotFound } from './tmdbNav.js';

function candidateToPickerItem(c) {
  return {
    id: c.id,
    mediaType: c.mediaType,
    title: c.title || `#${c.id}`,
    subtitle: c.subtitle,
    image: c.posterSrc,
    rating: c.tmdbRating || c.imdbRating || c.kpRating,
  };
}

export function closePicker() {
  state.pickerOpen = false;
  state.pickerItems = [];
  state.pickerShikiId = null;
}

async function onPickerSelect(card) {
  if (!card || card.id == null) return;
  const pick = state.pickerItems.find(
    (c) => c.id === Number(card.id) && c.mediaType === (card.mediaType || 'tv'),
  );
  if (!pick) return;
  if (!await verifyTmdbHit(pick)) {
    showNotFound();
    return;
  }
  await cacheTmdbChoice(state.pickerShikiId, pick);
  closePicker();
  navigateToTmdb(pick);
}

function pickerHint() {
  const type = state.pickerItems[0] && state.pickerItems[0].mediaType;
  return type === 'movie' ? t('picker.hintMovie') : t('picker.hintTv');
}

export function buildPickerModal() {
  if (!state.pickerOpen || !state.pickerItems.length) return null;
  return Modal()
    .open(true)
    .variant('modal')
    .closeOnBackdrop(true)
    .onClose(closePicker)
    .child(
      VStack().spacing(12).width('100%').children([
        Heading(t('picker.title')).level(3),
        Text(pickerHint()).variant('secondary'),
        Scroller()
          .orientation('vertical')
          .height('min(58vh, 38rem)')
          .width('100%')
          .child(
            PosterGrid()
              .items(state.pickerItems.map(candidateToPickerItem))
              .minWidth('9.5rem')
              .onCardClick(onPickerSelect),
          ),
      ]),
    );
}