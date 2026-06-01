import { PotokSDK } from 'potok-sdk';

export const state = PotokSDK.createState({
  selectedComponent: 'Badge',
  componentProps: {
    text: 'Бейдж',
    color: 'success',
    label: 'Поле ввода',
    placeholder: 'Введите...',
    value: '',
    checked: true,
    disabled: false,
    spacing: 8,
    variant: 'primary',
    level: 2
  }
});

export function setSelectedComponent(component) {
  state.selectedComponent = component;
}

export function updateComponentProps(props) {
  state.componentProps = {
    ...state.componentProps,
    ...props
  };
}

export function updateSingleProp(key, value) {
  state.componentProps = {
    ...state.componentProps,
    [key]: value
  };
}
