import { PotokSDK } from 'potok-sdk';

const { VStack, Card, Text, Badge, Spacer } = PotokSDK.ui.components;

export function buildStateMirrorCard(state) {
  return Card()
    .title("5. Реактивное Состояние (State Mirror)")
    .subtitle("Динамический рендеринг значений из состояния плагина")
    .child(
      VStack()
        .spacing(12)
        .children([
          Text("Введено в инпуте:").variant("secondary").size("sm"),
          Badge(state.inputValue || "Пустая строка").color("info"),
          Spacer().height(4),
          
          Text("Состояние свитча:").variant("secondary").size("sm"),
          Badge(state.toggleChecked ? "ВКЛЮЧЕН (true)" : "ВЫКЛЮЧЕН (false)").color(state.toggleChecked ? "success" : "error"),
          Spacer().height(4),
          
          Text("Выбранная опция списка:").variant("secondary").size("sm"),
          Badge(`Опция: ${state.selectValue}`).color("warning")
        ])
    );
}
