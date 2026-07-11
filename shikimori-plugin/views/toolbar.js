import { state } from '../state.js';
import {
  HStack, Spacer, SearchBar, Select, Button, t,
} from '../sdk.js';
import { isBrowsing, goCollections, onSearch, setOrder, setGenre } from '../navigation/routing.js';

export function toolbar() {
  const genreOptions = [{ value: '', label: t('filters.anyGenre') }];
  state.genres.forEach((g) => genreOptions.push({ value: String(g.id), label: g.russian || g.name }));

  const search = SearchBar('shiki-search')
    .placeholder(t('searchPlaceholder'))
    .value(state.query)
    .onChange(onSearch)
    .onClear(() => onSearch(''))
    .width('28rem');

  const left = [];
  if (isBrowsing()) {
    left.push(Button(t('backToCollections')).variant('glass').icon('arrow-left').onClick(goCollections));
  }
  left.push(search);

  return HStack().spacing(12).alignItems('center').children([
    ...left,
    Spacer(),
    Select('shiki-order').variant('glass').icon('arrow-down-wide-narrow')
      .value(state.order)
      .resetValue('popularity')
      .options([
        { value: 'popularity', label: t('order.popularity') },
        { value: 'ranked', label: t('order.ranked') },
        { value: 'aired_on', label: t('order.aired') },
      ])
      .onChange((v) => setOrder(Array.isArray(v) ? v[0] : v)),
    Select('shiki-genre').variant('glass').icon('tag')
      .value(state.genre)
      .resetValue('')
      .options(genreOptions)
      .onChange((v) => setGenre(Array.isArray(v) ? v[0] : v)),
  ]);
}