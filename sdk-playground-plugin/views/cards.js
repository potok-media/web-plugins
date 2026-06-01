import { PotokSDK } from 'potok-sdk';

const { VStack, Card, Text } = PotokSDK.ui.components;

export function buildCardsCard() {
  // 1. Карточка с заголовком и подзаголовком
  const cardWithHeader = Card()
    .title("Карточка с заголовком")
    .subtitle("Вспомогательное текстовое описание (subtitle)")
    .child(
      Text("Внутри этой карточки находится обычный текстовый блок. Карточки поддерживают нативное размытие фона и автоматически подстраиваются под тему оформления.")
        .variant("secondary")
    );

  // 2. Обычная базовая карточка (без шапки)
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

  return Card()
    .title("6. Карточки (Card)")
    .subtitle("Нативные контейнеры с эффектом матового стекла")
    .child(
      VStack()
        .spacing(16)
        .children([
          cardWithHeader,
          ordinaryCard
        ])
    );
}
