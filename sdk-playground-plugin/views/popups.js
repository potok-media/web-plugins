import { PotokSDK } from 'potok-sdk';
import { state, togglePopupsCode } from '../state.js';

const { VStack, HStack, Card, Heading, Text, Button, Spacer, Divider, Markdown } = PotokSDK.ui.components;

export function buildPopupsCard(setPopupOpen) {
  const childrenList = [
    HStack()
      .spacing(8)
      .alignItems("center")
      .children([
        Heading("6. Интерактивные диалоги и поповеры (EpisodeSelectorPopup)").level(3),
        Spacer(),
        Button("</>").variant("ghost").onClick(() => { togglePopupsCode(); })
      ])
  ];

  if (state.showPopupsCode) {
    childrenList.push(
      Markdown(
        `### 💻 Исходный код \`views/popups.js\`

\`\`\`js
${state.popupsCode || '// Загрузка исходного кода...'}
\`\`\`
`
      )
    );
    childrenList.push(Divider());
  }

  childrenList.push(
    Text("Этот компонент рендерит премиальный системный интерфейс для выбора seasons, episodes и звуковых дорожек. Плагины могут использовать его для организации структурированных каталогов многосерийных релизов.")
      .variant("secondary"),
    Button("Открыть селектор эпизодов")
      .variant("primary")
      .onClick(() => {
        setPopupOpen(true);
      })
  );

  return Card()
    .subtitle("Модальное окно выбора серий, сезонов и аудиодорожек")
    .child(
      VStack()
        .spacing(12)
        .children(childrenList)
    );
}
