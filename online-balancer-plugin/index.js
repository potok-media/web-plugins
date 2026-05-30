import { PotokSDK } from '../sdk.js';
import { VideoDBProvider } from './providers/videodb.js';
import { KinotochkaProvider } from './providers/kinotochka.js';
import { LiftProvider } from './providers/lift.js';

const { Card, VStack, HStack, Text, Input, Button, Spacer } = PotokSDK.ui.components;
const videoDB = new VideoDBProvider();
const kinotochka = new KinotochkaProvider();
const lift = new LiftProvider();

// 1. Register main plugin metadata in host
PotokSDK.registerPlugin({
  id: "potok-online-balancer",
  name: "Модульные Онлайн Источники",
  version: "2.0.0",
  description: "Клиентский порт Go-движка онлайн-балансеров (VideoDB, Kinotochka, Lift)"
});

// 2. Register lookup provider search engines in host registry
PotokSDK.registerSource({
  id: videoDB.id,
  name: videoDB.name,
  supportedTypes: ["movie", "tv"],
  lookup: (query) => videoDB.search(query)
});

PotokSDK.registerSource({
  id: kinotochka.id,
  name: kinotochka.name,
  supportedTypes: ["movie", "tv"],
  lookup: (query) => kinotochka.search(query)
});

PotokSDK.registerSource({
  id: lift.id,
  name: lift.name,
  supportedTypes: ["movie", "tv"],
  lookup: (query) => lift.search(query)
});

// 3. Settings Slot Tab contribution
PotokSDK.registerSlotContribution({
  slotName: "settings-tabs",
  id: "online-balancer-settings",
  render(props) {
    const state = PotokSDK.createState({
      apiKey: "",
      isSaving: false
    });

    const settingsLayout = VStack()
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

    state.$subscribe(() => {
      PotokSDK.ui.render(settingsLayout);
    });

    // Render immediately to prevent blank tab during load, then load stored key
    PotokSDK.ui.render(settingsLayout);

    PotokSDK.storage.local.getItem("videodb_key").then(key => {
      if (key) {
        state.apiKey = key;
        PotokSDK.ui.render(settingsLayout);
      }
    });

    return {
      label: "Онлайн балансеры",
      icon: "Sliders",
      layout: settingsLayout
    };
  }
});

