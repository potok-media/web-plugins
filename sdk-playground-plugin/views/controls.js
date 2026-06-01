import { PotokSDK } from 'potok-sdk';

const { VStack, HStack, Card, Text, Button, Divider, Badge } = PotokSDK.ui.components;

export function buildControlsCard() {
  return Card()
    .title("2. Кнопки и Индикаторы (Button & Badge)")
    .subtitle("Варианты кнопок и информационные бейджи статусов")
    .child(
      VStack()
        .spacing(14)
        .children([
          Text("Варианты кнопок (Button):").bold(true).variant("primary").size("sm"),
          HStack().spacing(8).children([
            Button("Primary").variant("primary").onClick(() => PotokSDK.ui.showHUD("success", "Нажата кнопка Primary!")),
            Button("Secondary").variant("secondary").onClick(() => PotokSDK.ui.showHUD("info", "Нажата кнопка Secondary!")),
            Button("Ghost").variant("ghost").onClick(() => PotokSDK.ui.showHUD("warning", "Нажата кнопка Ghost!")),
            Button("Danger").variant("danger").onClick(() => PotokSDK.ui.showHUD("error", "Нажата кнопка Danger!"))
          ]),
          HStack().spacing(8).children([
            Button("Заблокировано").variant("primary").disabled(true)
          ]),
          Divider(),
          Text("Цветовые бейджи (Badge):").bold(true).variant("primary").size("sm"),
          HStack().spacing(8).children([
            Badge("Успешно").color("success"),
            Badge("Предупреждение").color("warning"),
            Badge("Ошибка").color("error"),
            Badge("Инфо").color("info")
          ])
        ])
    );
}
