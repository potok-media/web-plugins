import { PotokSDK } from 'potok-sdk';

const { VStack, Card, Text, StreamRowComponent } = PotokSDK.ui.components;

export function buildStreamCard() {
  return Card()
    .title("4. Карточка фильма / раздачи (StreamRowComponent)")
    .subtitle("Демонстрация нативного сложного медиа-элемента результатов поиска")
    .child(
      VStack()
        .spacing(12)
        .children([
          Text("Интерактивный торрент-поток (кликните для выбора):").variant("secondary").size("sm"),
          StreamRowComponent()
            .stream({
              title: "Люди Икс: Начало. Росомаха / X-Men Origins: Wolverine (2009) BDRip 1080p | Лицензия",
              tracker: "Rutracker",
              sizeLabel: "7.9 GB",
              seeders: 245,
              leechers: 12,
              publishDate: "2026-05-15T12:00:00Z",
              tags: [
                { kind: "quality", value: "1080p" },
                { kind: "audio", value: "Дубляж" },
                { kind: "source", value: "BDRip" }
              ]
            })
            .onClick((stream) => {
              PotokSDK.ui.showHUD("success", `Выбран видеопоток: ${stream.title} (${stream.sizeLabel})`);
            })
        ])
    );
}
