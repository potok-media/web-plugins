import { PotokSDK } from 'potok-sdk';
import { state, toggleStateCode } from '../state.js';

const { VStack, HStack, Card, Heading, Text, Badge, Spacer, Button, Divider, Markdown } = PotokSDK.ui.components;

const docString = `### 🔄 Реактивное состояние в Potok SDK

Состояние создается методом \`PotokSDK.createState(initialState)\` и является реактивным. При изменении свойств объекта состояния, UI автоматически и бесшовно перерисовывается.

#### Использование в коде (Реальный JS Layout Builder):
\`\`\`js
import { PotokSDK } from 'potok-sdk';
import { toggleStateCode } from '../state.js';

const { VStack, HStack, Card, Heading, Text, Badge, Spacer, Button, Divider, Markdown } = PotokSDK.ui.components;

export function buildStateMirrorCard(state) {
  const childrenList = [
    HStack()
      .spacing(8)
      .alignItems("center")
      .children([
        Heading("7. Реактивное Состояние (State Mirror)").level(3),
        Spacer(),
        Button("</>").variant("ghost").onClick(() => { toggleStateCode(); })
      ])
  ];

  if (state.showStateCode) {
    childrenList.push(Markdown(docString));
    childrenList.push(Divider());
  }

  childrenList.push(
    Text("Введено в инпуте:").variant("secondary").size("sm"),
    Badge(state.inputValue || "Пустая строка").color("info"),
    Spacer().height(4),
    
    Text("Состояние свитча:").variant("secondary").size("sm"),
    Badge(state.toggleChecked ? "ВКЛЮЧЕН (true)" : "ВЫКЛЮЧЕН (false)").color(state.toggleChecked ? "success" : "error"),
    Spacer().height(4),
    
    Text("Выбранная опция списка:").variant("secondary").size("sm"),
    Badge(\`Опция: \${state.selectValue}\`).color("warning")
  );

  return Card()
    .subtitle("Динамический рендеринг значений из состояния плагина")
    .child(
      VStack()
        .spacing(12)
        .children(childrenList)
    );
}
\`\`\`
`;

export function getStateDoc() {
  if (state.stateCode) {
    return `### 🔄 Настоящий код макета State Mirror

Этот блок отображает **реальный, живой исходный код** текущего файла с диска, загруженный динамически в режиме реального времени.

#### Исходный код файла (\`views/stateMirror.js\`):
\`\`\`js
${state.stateCode}
\`\`\`
`;
  }
  return docString;
}

export function buildStateMirrorCard(state) {
  const childrenList = [
    HStack()
      .spacing(8)
      .alignItems("center")
      .children([
        Heading("7. Реактивное Состояние (State Mirror)").level(3),
        Spacer(),
        Button("</>").variant("ghost").onClick(() => { toggleStateCode(); })
      ])
  ];

  if (state.showStateCode) {
    childrenList.push(Markdown(getStateDoc()));
    childrenList.push(Divider());
  }

  childrenList.push(
    Text("Введено в инпуте:").variant("secondary").size("sm"),
    Badge(state.inputValue || "Пустая строка").color("info"),
    Spacer().height(4),
    
    Text("Состояние свитча:").variant("secondary").size("sm"),
    Badge(state.toggleChecked ? "ВКЛЮЧЕН (true)" : "ВЫКЛЮЧЕН (false)").color(state.toggleChecked ? "success" : "error"),
    Spacer().height(4),
    
    Text("Выбранная опция списка:").variant("secondary").size("sm"),
    Badge(`Опция: ${state.selectValue}`).color("warning")
  );

  return Card()
    .subtitle("Динамический рендеринг значений из состояния плагина")
    .child(
      VStack()
        .spacing(12)
        .children(childrenList)
    );
}
