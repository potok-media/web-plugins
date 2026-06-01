import { PotokSDK } from 'potok-sdk';
import { state, toggleControlsCode } from '../state.js';

const { VStack, HStack, Card, Heading, Text, Button, Divider, Badge, LoadingSpinner, Spacer, Markdown } = PotokSDK.ui.components;

const docString = `### 🎛️ Компоненты Button, Badge и LoadingSpinner

Интерактивные управляющие элементы, статусы и системные лоадеры для ожидания асинхронных операций.

#### Использование в коде:
\`\`\`js
// Кнопка (Button)
Button("Оформить заказ")
  .variant("primary") // primary, secondary, danger, ghost
  .disabled(false)
  .onClick(() => {
    PotokSDK.ui.showHUD("success", "Кнопка нажата!");
  })

// Цветной бейдж (Badge)
Badge("Ожидает оплаты")
  .color("warning") // success, warning, error, info

// Системный лоадер загрузки (LoadingSpinner)
LoadingSpinner()
  .message("Соединение с блокчейн-узлом...")
  .height("90px")
\`\`\`
`;

export function buildControlsCard() {
  const childrenList = [
    HStack()
      .spacing(8)
      .alignItems("center")
      .children([
        Heading("2. Кнопки, Бейджи и Лоадеры (Button, Badge & LoadingSpinner)").level(3),
        Spacer(),
        Button("</>").variant("ghost").onClick(() => { toggleControlsCode(); })
      ])
  ];

  if (state.showControlsCode) {
    childrenList.push(Markdown(docString));
    childrenList.push(Divider());
  }

  childrenList.push(
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
  );

  return Card()
    .subtitle("Интерактивные элементы, статусы и системные лоадеры загрузки")
    .child(
      VStack()
        .spacing(14)
        .children(childrenList)
    );
}
