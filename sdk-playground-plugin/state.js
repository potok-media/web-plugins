import { PotokSDK } from 'potok-sdk';

export const state = PotokSDK.createState({
  inputValue: 'Демо-текст',
  toggleChecked: true,
  selectValue: 'A'
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
