import { PotokSDK } from 'potok-sdk';

export const state = PotokSDK.createState({
  inputValue: 'Демо-текст',
  toggleChecked: true,
  selectValue: 'A',
  activeCategory: 'typography', // Дефолтная категория
  isPopupOpen: false,           // Состояние открытия EpisodeSelectorPopup
  searchQuery: '',              // Запрос в SafeSearchBar
  mediaPlayerPlayback: null,    // Активный поток для воспроизведения плеере
  activeFilterTracker: 'all',   // Выбранный трекер в StreamFilterBar
  activeFilterQuality: 'all'    // Выбранное качество в StreamFilterBar
});

export function setInputValue(val) {
  state.inputValue = val;
}

export function setToggleChecked(val) {
  state.toggleChecked = val;
}

export function setSelectValue(val) {
  state.selectValue = val;
}

export function setActiveCategory(val) {
  state.activeCategory = val;
}

export function setPopupOpen(val) {
  state.isPopupOpen = val;
}

export function setSearchQuery(val) {
  state.searchQuery = val;
}

export function setMediaPlayerPlayback(val) {
  state.mediaPlayerPlayback = val;
}

export function setActiveFilterTracker(val) {
  state.activeFilterTracker = val;
}

export function setActiveFilterQuality(val) {
  state.activeFilterQuality = val;
}
