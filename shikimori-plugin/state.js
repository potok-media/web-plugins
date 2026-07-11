import { PotokSDK } from 'potok-sdk';

export const state = PotokSDK.createState({
  shelves: {},
  query: '',
  order: 'popularity',
  genre: '',
  status: '',
  kind: '',
  browse: false,
  page: 1,
  items: [],
  catLoading: false,
  loadingMore: false,
  hasMore: true,
  genres: [],
  pickerOpen: false,
  pickerItems: [],
  pickerShikiId: null,
});