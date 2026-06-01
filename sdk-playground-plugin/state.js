import { PotokSDK } from 'potok-sdk';

export const state = PotokSDK.createState({
  inputValue: 'Демо-текст',
  toggleChecked: true,
  selectValue: 'A',
  activeCategory: 'typography', // Дефолтная категория
  isPopupOpen: false,           // Состояние открытия EpisodeSelectorPopup
  searchQuery: '',              // Запрос в SafeSearchBar
  searchResults: [],            // Настоящие результаты с TMDB
  searchLoading: false,         // Статус загрузки из сети
  mediaPlayerPlayback: null,    // Активный поток для воспроизведения плеере
  activeFilterTracker: 'all',   // Выбранный трекер в StreamFilterBar
  activeFilterQuality: 'all',    // Выбранное качество в StreamFilterBar
  showTypographyCode: false,
  showControlsCode: false,
  showFormsCode: false,
  showMediaCode: false,
  showCardsCode: false,
  showPopupsCode: false,
  showStateCode: false,
  typographyCode: '',
  controlsCode: '',
  formsCode: '',
  mediaCode: '',
  cardsCode: '',
  popupsCode: '',
  stateCode: ''
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

let currentSearchTimeout = null;

export function setSearchQuery(val) {
  state.searchQuery = val;
  
  if (currentSearchTimeout) {
    clearTimeout(currentSearchTimeout);
  }

  const query = (val || "").trim();
  if (!query) {
    state.searchResults = [];
    state.searchLoading = false;
    return;
  }

  state.searchLoading = true;

  // Дебаунс 350мс для предотвращения сетевого спама при быстром наборе
  currentSearchTimeout = setTimeout(async () => {
    try {
      const res = await PotokSDK.http.get(`/api/media/search?query=${encodeURIComponent(query)}`);
      
      // Защита от race condition: проверяем, что поисковый запрос не изменился за время запроса
      if (state.searchQuery !== val) return;

      if (res && res.data) {
        const items = JSON.parse(res.data);
        if (Array.isArray(items)) {
          // Ограничиваем выдачу 7 карточками по требованию пользователя
          state.searchResults = items.slice(0, 7);
        } else {
          state.searchResults = [];
        }
      } else {
        state.searchResults = [];
      }
    } catch (err) {
      console.error("[SDK Playground] TMDB search request failed:", err);
      if (state.searchQuery === val) {
        state.searchResults = [];
      }
    } finally {
      if (state.searchQuery === val) {
        state.searchLoading = false;
      }
    }
  }, 350);
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

export function toggleTypographyCode() {
  state.showTypographyCode = !state.showTypographyCode;
}

export function toggleControlsCode() {
  state.showControlsCode = !state.showControlsCode;
}

export function toggleFormsCode() {
  state.showFormsCode = !state.showFormsCode;
}

export function toggleMediaCode() {
  state.showMediaCode = !state.showMediaCode;
}

export function toggleCardsCode() {
  state.showCardsCode = !state.showCardsCode;
}

export function togglePopupsCode() {
  state.showPopupsCode = !state.showPopupsCode;
}

export function toggleStateCode() {
  state.showStateCode = !state.showStateCode;
}

export async function initializeCodes() {
  const views = [
    { key: 'typographyCode', path: './views/typography.js' },
    { key: 'controlsCode', path: './views/controls.js' },
    { key: 'formsCode', path: './views/forms.js' },
    { key: 'mediaCode', path: './views/stream.js' },
    { key: 'cardsCode', path: './views/cards.js' },
    { key: 'popupsCode', path: './views/popups.js' },
    { key: 'stateCode', path: './views/stateMirror.js' }
  ];

  for (const item of views) {
    try {
      const res = await fetch(item.path);
      if (res.ok) {
        const text = await res.text();
        state[item.key] = text;
      }
    } catch (err) {
      console.warn(`[SDK Playground] Failed to fetch live code for ${item.key}:`, err);
    }
  }
}
