import { PotokSDK } from 'potok-sdk';

const { VStack, Card, Text, MediaCard } = PotokSDK.ui.components;

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

  // 3. Нативная карточка фильма (MediaCard)
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
        percentage: 45 // Показывает прогресс просмотра
      }
    })
    .onClick((item) => {
      PotokSDK.ui.showHUD("success", `Нажата карточка фильма: ${item.title}`);
    });

  return Card()
    .title("5. Нативные контейнеры и карточки (Card & MediaCard)")
    .subtitle("Базовые контейнеры матового стекла и премиальные карточки фильмов")
    .child(
      VStack()
        .spacing(16)
        .children([
          cardWithHeader,
          ordinaryCard,
          Text("MediaCard (Нативная карточка фильма с постером и прогрессом):").bold(true).variant("primary").size("sm"),
          moviePosterCard
        ])
    );
}
