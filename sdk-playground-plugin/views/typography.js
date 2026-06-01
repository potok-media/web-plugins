import { PotokSDK } from 'potok-sdk';
import { state, toggleTypographyCode } from '../state.js';

const { VStack, HStack, Card, Heading, Text, Divider, Spacer, Button, Markdown } = PotokSDK.ui.components;

const docString = `### 📝 Компонент Heading и Text

Компоненты типографики используются для рендеринга иерархических заголовков и стилизованного текстового контента. Они обеспечивают идеальное соответствие дизайн-системе Potok.

#### Использование в коде:
\`\`\`js
// Заголовок (Heading)
Heading("Ваш заголовок")
  .level(1) // Доступные уровни заголовков: от 1 до 4

// Обычный текст (Text)
Text("Описание вашего интерфейса")
  .variant("primary") // Варианты: primary, secondary, hint, error, success
  .size("md")         // Размеры: xs, sm, md, lg
  .bold(true)         // Жирное начертание
\`\`\`
`;

export function buildTypographyCard() {
  const childrenList = [
    HStack()
      .spacing(8)
      .alignItems("center")
      .children([
        Heading("1. Типографика и Текст (Heading & Text)").level(3),
        Spacer(),
        Button("</>").variant("ghost").onClick(() => { toggleTypographyCode(); })
      ])
  ];

  if (state.showTypographyCode) {
    childrenList.push(Markdown(docString));
    childrenList.push(Divider());
  }

  childrenList.push(
    Heading("Заголовок h1").level(1),
    Heading("Заголовок h2").level(2),
    Heading("Заголовок h3").level(3),
    Heading("Заголовок h4").level(4),
    Divider(),
    Text("Основной текст (primary)").variant("primary"),
    Text("Вторичный текст (secondary)").variant("secondary"),
    Text("Текст успеха (success)").variant("success"),
    Text("Текст ошибки (error)").variant("error"),
    Text("Текст-подсказка (hint)").variant("hint"),
    Text("Жирный текст").bold(true)
  );

  return Card()
    .subtitle("Заголовки разных уровней и варианты текстовых блоков")
    .child(
      VStack()
        .spacing(12)
        .children(childrenList)
    );
}
