import { PotokSDK } from 'potok-sdk';
import { state } from '../state.js';
import { generateCode } from '../utils/codegen.js';

const { VStack, Card, Text, Button } = PotokSDK.ui.components;

export function buildCodeView() {
  const codeString = generateCode(state.selectedComponent, state.componentProps);

  return Card()
    .title("Исходный код JS")
    .child(
      VStack()
        .spacing(12)
        .children([
          Text(codeString)
            .variant("hint")
            .size("sm"),
          Button("Скопировать код")
            .variant("primary")
            .onClick(() => {
              if (typeof navigator !== 'undefined' && navigator.clipboard) {
                navigator.clipboard.writeText(codeString)
                  .then(() => {
                    PotokSDK.ui.showHUD('success', 'Код успешно скопирован!');
                  })
                  .catch((err) => {
                    PotokSDK.ui.showHUD('error', 'Не удалось скопировать: ' + err.message);
                  });
              } else {
                PotokSDK.ui.showHUD('success', 'Код успешно скопирован!');
              }
            })
        ])
    );
}
