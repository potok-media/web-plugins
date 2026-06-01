import { PotokSDK } from 'potok-sdk';
import { state } from '../state.js';

const { VStack, Card, Badge, Button, Heading, Text, Divider, Spacer, Input, Toggle, Select } = PotokSDK.ui.components;

export function buildPreview() {
  const props = state.componentProps;
  let previewComponent = null;

  switch (state.selectedComponent) {
    case 'Badge':
      previewComponent = Badge(props.text || '')
        .color(props.color || 'info');
      break;

    case 'Button':
      previewComponent = Button(props.text || '')
        .variant(props.variant || 'primary')
        .disabled(!!props.disabled);
      break;

    case 'Heading':
      previewComponent = Heading(props.text || '')
        .level(props.level || 1);
      break;

    case 'Text':
      previewComponent = Text(props.text || '')
        .variant(props.variant || 'primary');
      break;

    case 'Divider':
      previewComponent = Divider();
      break;

    case 'Spacer':
      previewComponent = Spacer();
      break;

    case 'Input':
      previewComponent = Input()
        .label(props.label || '')
        .placeholder(props.placeholder || '')
        .disabled(!!props.disabled);
      break;

    case 'Toggle':
      previewComponent = Toggle()
        .label(props.label || '')
        .checked(!!props.checked)
        .disabled(!!props.disabled);
      break;

    case 'Select':
      previewComponent = Select()
        .label(props.label || '')
        .disabled(!!props.disabled)
        .options([
          { value: 'option1', label: 'Option 1' },
          { value: 'option2', label: 'Option 2' }
        ]);
      break;

    case 'Card':
      previewComponent = Card()
        .title(props.title || '');
      break;

    default:
      previewComponent = Text('Компонент не поддерживается');
  }

  return Card()
    .title("Живой предпросмотр")
    .child(
      VStack()
        .spacing(12)
        .children([
          previewComponent
        ])
    );
}
