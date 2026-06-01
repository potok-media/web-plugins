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
    childrenList.push(
      Markdown(
        `### 💻 Исходный код \`views/stateMirror.js\`

\`\`\`js
${state.stateCode || '// Загрузка исходного кода...'}
\`\`\`
`
      )
    );
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
