import { PotokSDK } from 'potok-sdk';
import { state, togglePopupsCode } from '../state.js';

const { VStack, HStack, Card, Heading, Text, Button, Spacer, Divider, Markdown } = PotokSDK.ui.components;

const docString = `### 💬 Реальный код макета Popups

Нативный модальный поповер выбора сезонов, серий и аудиодорожек с поддержкой превью, сетевой пагинации и сохранения переопределений.

#### Использование в коде (Реальный JS Layout Builder):
\`\`\`js
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
    childrenList.push(Markdown(docString));
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
\`\`\`
`;

export function getPopupsDoc() {
  if (state.popupsCode) {
    return `### 💬 Настоящий код макета Popups

Этот блок отображает **реальный, живой исходный код** текущего файла с диска, загруженный динамически в режиме реального времени.

#### Исходный код файла (\`views/popups.js\`):
\`\`\`js
${state.popupsCode}
\`\`\`
`;
  }
  return docString;
}

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
    childrenList.push(Markdown(getPopupsDoc()));
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
