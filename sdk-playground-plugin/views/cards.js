import { PotokSDK } from 'potok-sdk';
import { state, toggleCardsCode } from '../state.js';

const { VStack, HStack, Card, Heading, Text, MediaCard, Spacer, Button, Divider, Markdown } = PotokSDK.ui.components;

const docString = `### 🎴 Реальный код макета Cards

Компоненты контейнеров используются для визуальной группировки контента и предоставления метаданных релизов.

#### Использование в коде (Реальный JS Layout Builder):
\`\`\`js
import { PotokSDK } from 'potok-sdk';
import { state, toggleCardsCode } from '../state.js';

const { VStack, HStack, Card, Heading, Text, MediaCard, Spacer, Button, Divider, Markdown } = PotokSDK.ui.components;

export function buildCardsCard() {
  const cardWithHeader = Card()
    .title("Карточка с заголовком")
    .subtitle("Вспомогательное текстовое описание (subtitle)")
    .child(
      Text("Внутри этой карточки находится обычный текстовый блок. Карточки поддерживают нативное размытие фона и автоматически подстраиваются под тему оформления.")
        .variant("secondary")
    );

  const ordinaryCard = Card()
    .child(
      VStack()
        .spacing(8)
        .children([
          Text("Базовая карточка (без шапки)").bold(true).variant("primary"),
          Text("Это чистая карточка без заголовков. Внутри неё находится VStack с несколькими текстовыми блоками. Сюда можно поместить абсолютно любые элементы.")
            .variant("secondary")
        ])
    );

  const moviePosterCard = MediaCard()
    .item({
      id: 104,
      title: "Марсианин",
      subtitle: "The Martian (2015)",
      mediaType: "movie",
      posterSrc: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=260&h=380&q=80",
      tmdbRating: 8.0,
      kpRating: 7.9,
      progress: {
        percentage: 45
      }
    })
    .onClick((item) => {
      PotokSDK.ui.showHUD("success", \`Нажата карточка фильма: \${item.title}\`);
    });

  const childrenList = [
    HStack()
      .spacing(8)
      .alignItems("center")
      .children([
        Heading("5. Нативные контейнеры и карточки (Card & MediaCard)").level(3),
        Spacer(),
        Button("</>").variant("ghost").onClick(() => { toggleCardsCode(); })
      ])
  ];

  if (state.showCardsCode) {
    childrenList.push(Markdown(docString));
    childrenList.push(Divider());
  }

  childrenList.push(
    cardWithHeader,
    ordinaryCard,
    Text("MediaCard (Нативная карточка фильма с постером и прогрессом):").bold(true).variant("primary").size("sm"),
    moviePosterCard
  );

  return Card()
    .subtitle("Базовые контейнеры матового стекла и премиальные карточки фильмов")
    .child(
      VStack()
        .spacing(16)
        .children(childrenList)
    );
}
\`\`\`
`;

export function getCardsDoc() {
  if (state.cardsCode) {
    return `### 🎴 Настоящий код макета Cards

Этот блок отображает **реальный, живой исходный код** текущего файла с диска, загруженный динамически в режиме реального времени.

#### Исходный код файла (\`views/cards.js\`):
\`\`\`js
${state.cardsCode}
\`\`\`
`;
  }
  return docString;
}

export function buildCardsCard() {
  const cardWithHeader = Card()
    .title("Карточка с заголовком")
    .subtitle("Вспомогательное текстовое описание (subtitle)")
    .child(
      Text("Внутри этой карточки находится обычный текстовый блок. Карточки поддерживают нативное размытие фона и автоматически подстраиваются под тему оформления.")
        .variant("secondary")
    );

  const ordinaryCard = Card()
    .child(
      VStack()
        .spacing(8)
        .children([
          Text("Базовая карточка (без шапки)").bold(true).variant("primary"),
          Text("Это чистая карточка без заголовков. Внутри неё находится VStack с несколькими текстовыми блоками. Сюда можно поместить абсолютно любые элементы.")
            .variant("secondary")
        ])
    );

  const moviePosterCard = MediaCard()
    .item({
      id: 104,
      title: "Марсианин",
      subtitle: "The Martian (2015)",
      mediaType: "movie",
      posterSrc: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=260&h=380&q=80",
      tmdbRating: 8.0,
      kpRating: 7.9,
      progress: {
        percentage: 45
      }
    })
    .onClick((item) => {
      PotokSDK.ui.showHUD("success", `Нажата карточка фильма: ${item.title}`);
    });

  const childrenList = [
    HStack()
      .spacing(8)
      .alignItems("center")
      .children([
        Heading("5. Нативные контейнеры и карточки (Card & MediaCard)").level(3),
        Spacer(),
        Button("</>").variant("ghost").onClick(() => { toggleCardsCode(); })
      ])
  ];

  if (state.showCardsCode) {
    childrenList.push(Markdown(getCardsDoc()));
    childrenList.push(Divider());
  }

  childrenList.push(
    cardWithHeader,
    ordinaryCard,
    Text("MediaCard (Нативная карточка фильма с постером и прогрессом):").bold(true).variant("primary").size("sm"),
    moviePosterCard
  );

  return Card()
    .subtitle("Базовые контейнеры матового стекла и премиальные карточки фильмов")
    .child(
      VStack()
        .spacing(16)
        .children(childrenList)
    );
}
