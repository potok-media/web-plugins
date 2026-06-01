import { PotokSDK } from 'potok-sdk';

const { VStack, HStack, Card, Text, Button, Divider, Badge, LoadingSpinner } = PotokSDK.ui.components;

export function buildControlsCard() {
  return Card()
    .title("2. Кнопки, Бейджи и Лоадеры (Button, Badge & LoadingSpinner)")
    .subtitle("Интерактивные элементы, статусы и системные лоадеры загрузки")
    .child(
      VStack()
        .spacing(14)
        .children([
          Text("Варианты кнопок (Button):").bold(true).variant("primary").size("sm"),
          HStack().spacing(8).children([
            Button("Primary").variant("primary").onClick(() => {}),
            Button("Secondary").variant("secondary").onClick(() => {}),
            Button("Ghost").variant("ghost").onClick(() => {}),
            Button("Danger").variant("danger").onClick(() => {})
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
          ]),

          Divider(),

          Text("Индикатор загрузки (LoadingSpinner):").bold(true).variant("primary").size("sm"),
          LoadingSpinner()
            .message("Синхронизация с облачным медиа-сервером...")
            .height("90px")
        ])
    );
}
