import { PotokSDK } from 'potok-sdk';

const { VStack, Card, Heading, Text, Divider } = PotokSDK.ui.components;

export function buildTypographyCard() {
  return Card()
    .title("1. Типографика и Текст (Heading & Text)")
    .subtitle("Заголовки разных уровней и варианты текстовых блоков")
    .child(
      VStack()
        .spacing(12)
        .children([
          Heading("Заголовок h1").level(1),
          Heading("Заголовок h2").level(2),
          Heading("Заголовок h3").level(3),
          Heading("Заголовок h4").level(4),
          Divider(),
          Text("Основной текст (primary)").variant("primary"),
          Text("Вторичный текст (secondary)").variant("secondary"),
          Text("Текст успеха (success)").variant("success"),
          Text("Текст ошибки (error)").variant("error"),
          Text("Текст-подсказка (hint)").variant("hint"),
          Text("Жирный текст").bold(true)
        ])
    );
}
