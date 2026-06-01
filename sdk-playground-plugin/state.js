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
