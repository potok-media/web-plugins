import { PotokSDK } from '../sdk.js';

const { Card, VStack, Button, Input } = PotokSDK.ui.components;

export function registerSettingsSlot() {
  PotokSDK.registerSlotContribution({
    slotName: "settings-tabs",
    id: "online-balancer-settings",
    render(props) {
      const state = PotokSDK.createState({
        apiKey: "",
        isSaving: false
      });

      const buildLayout = () => {
        return VStack()
          .spacing(16)
          .child(
            Card()
              .title("Настройки онлайн-балансеров")
              .subtitle("Задайте API-ключи для доступа к премиум-потокам высокого качества.")
              .child(
                VStack()
                  .spacing(12)
                  .child(
                    Input("videodb_key")
                      .label("API Ключ VideoDB Cloud")
                      .placeholder("Например: a5d8f2...")
                      .type("password")
                      .value(state.apiKey)
                      .onChange((val) => {
                        state.apiKey = val;
                      })
                  )
                  .child(
                    Button(state.isSaving ? "Сохранение..." : "Сохранить ключи")
                      .variant("primary")
                      .onClick(async () => {
                        state.isSaving = true;
                        await PotokSDK.storage.local.setItem("videodb_key", state.apiKey);
                        state.isSaving = false;
                        PotokSDK.ui.showHUD("success", "API-ключи плагина успешно обновлены!");
                      })
                  )
              )
          );
      };

      state.$subscribe(() => {
        PotokSDK.ui.render(buildLayout(), "online-balancer-settings");
      });

      // Render immediately to prevent blank tab during load, then load stored key
      PotokSDK.ui.render(buildLayout(), "online-balancer-settings");

      PotokSDK.storage.local.getItem("videodb_key").then(key => {
        if (key) {
          state.apiKey = key;
          PotokSDK.ui.render(buildLayout(), "online-balancer-settings");
        }
      });

      return {
        label: "Онлайн балансеры",
        icon: "Sliders",
        layout: buildLayout()
      };
    }
  });
}
