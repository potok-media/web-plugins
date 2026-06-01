import { PotokSDK } from 'potok-sdk';
import { state, setSelectedComponent, updateSingleProp } from '../state.js';
import { getAvailableComponents, metadataRegistry } from '../utils/inspector.js';

const { VStack, Card, Select, Input, Toggle } = PotokSDK.ui.components;

export function buildControls() {
  const availableComponents = getAvailableComponents();
  const componentOptions = availableComponents.map(name => ({ value: name, label: name }));

  const componentSelector = Select("component-selector")
    .label("Компонент")
    .options(componentOptions)
    .selected(state.selectedComponent)
    .onChange((val) => {
      setSelectedComponent(val);
    });

  const activeProps = metadataRegistry[state.selectedComponent] || [];
  const propControls = [];

  activeProps.forEach((prop) => {
    if (['text', 'label', 'placeholder', 'title'].includes(prop)) {
      let label = '';
      if (prop === 'text') label = 'Текст';
      else if (prop === 'label') label = 'Метка (Label)';
      else if (prop === 'placeholder') label = 'Плейсхолдер';
      else if (prop === 'title') label = 'Заголовок (Title)';

      propControls.push(
        Input(`prop-${prop}`)
          .label(label)
          .value(state.componentProps[prop] || '')
          .onChange((val) => updateSingleProp(prop, val))
      );
    } else if (prop === 'color') {
      propControls.push(
        Select("prop-color")
          .label("Цвет")
          .options([
            { value: "success", label: "success" },
            { value: "error", label: "error" },
            { value: "warning", label: "warning" },
            { value: "info", label: "info" }
          ])
          .selected(state.componentProps.color || "info")
          .onChange((val) => updateSingleProp("color", val))
      );
    } else if (prop === 'variant') {
      propControls.push(
        Select("prop-variant")
          .label("Вариант")
          .options([
            { value: "primary", label: "primary" },
            { value: "secondary", label: "secondary" },
            { value: "ghost", label: "ghost" },
            { value: "danger", label: "danger" }
          ])
          .selected(state.componentProps.variant || "secondary")
          .onChange((val) => updateSingleProp("variant", val))
      );
    } else if (prop === 'level') {
      propControls.push(
        Select("prop-level")
          .label("Уровень")
          .options([
            { value: "1", label: "1" },
            { value: "2", label: "2" },
            { value: "3", label: "3" },
            { value: "4", label: "4" }
          ])
          .selected(String(state.componentProps.level || 1))
          .onChange((val) => updateSingleProp("level", Number(val)))
      );
    } else if (prop === 'checked' || prop === 'disabled') {
      let label = prop === 'checked' ? 'Выбрано' : 'Заблокирован';
      propControls.push(
        Toggle(`prop-${prop}`)
          .label(label)
          .checked(!!state.componentProps[prop])
          .onChange((val) => updateSingleProp(prop, val))
      );
    }
  });

  return Card()
    .title("Настройка компонента")
    .child(
      VStack()
        .spacing(12)
        .children([
          componentSelector,
          ...propControls
        ])
    );
}
