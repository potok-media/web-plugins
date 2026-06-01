import { PotokSDK } from 'potok-sdk';

const { VStack, Card, Text, Button } = PotokSDK.ui.components;

export function buildPopupsCard(setPopupOpen) {
  return Card()
    .title("6. Интерактивные диалоги и поповеры (EpisodeSelectorPopup)")
    .subtitle("Модальное окно выбора серий, сезонов и аудиодорожек")
    .child(
      VStack()
        .spacing(12)
        .children([
          Text("Этот компонент рендерит премиальный системный интерфейс для выбора сезонов, серий и звуковых дорожек. Плагины могут использовать его для организации структурированных каталогов многосерийных релизов.")
            .variant("secondary"),
          Button("Открыть селектор эпизодов")
            .variant("primary")
            .onClick(() => {
              setPopupOpen(true);
            })
        ])
    );
}
