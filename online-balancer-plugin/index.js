import { PotokSDK } from '../sdk.js';
import { VideoDBProvider } from './providers/videodb.js';

const { Card, VStack, HStack, Text, Input, Button, Spacer } = PotokSDK.ui.components;
const videoDB = new VideoDBProvider();

// 1. Register main plugin metadata in host
PotokSDK.registerPlugin({
  id: "potok-online-balancer",
  name: "Модульные Онлайн Источники",
  version: "2.0.0",
  description: "Клиентский порт Go-движка поиска VideoDB"
});

// 2. Register lookup provider search engine in host registry
PotokSDK.registerSource({
  id: videoDB.id,
  name: videoDB.name,
  supportedTypes: ["movie", "tv"],
  lookup: (query) => videoDB.search(query)
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

// 4. Media Actions Page Widget contribution (Completely key-optional now!)
PotokSDK.registerSlotContribution({
  slotName: "media-actions",
  id: "online-balancer-widget",
  render(props) {
    const state = PotokSDK.createState({
      isLoading: false,
      hasSearched: false,
      streams: []
    });

    // Helper to run actual client search on demand
    const runSearch = async () => {
      state.isLoading = true;
      try {
        const query = {
          type: props.mediaType,
          tmdbId: props.tmdbId,
          season: props.season,
          episode: props.episode
        };
        const results = await videoDB.search(query);
        state.streams = results;
        state.hasSearched = true;
      } catch (err) {
        PotokSDK.ui.showHUD("error", "Не удалось загрузить онлайн-потоки");
      } finally {
        state.isLoading = false;
      }
    };

    // Helper to start video stream in the host's native browser media player
    const playStream = (stream) => {
      PotokSDK.ui.playVideo({
        streamUrl: stream.url,
        title: `${props.title} (${stream.voice})`,
        mediaType: props.mediaType,
        id: props.mediaId,
        season: props.season,
        episode: props.episode,
        torrentHash: "" // Flag to bypass torrent service loading
      });
      PotokSDK.ui.showHUD("success", `Запуск воспроизведения: ${stream.voice}`);
    };

    // Re-compile layout reactively upon state alterations
    const buildLayout = () => {
      const container = VStack().spacing(12).width("100%");

      if (!state.hasSearched && !state.isLoading) {
        container.child(
          Button("Смотреть Онлайн")
            .variant("primary")
            .width("100%")
            .onClick(() => {
              runSearch();
            })
        );
      } else if (state.isLoading) {
        container.child(
          Button("Поиск онлайн-потоков...")
            .variant("secondary")
            .disabled(true)
            .width("100%")
        );
      } else {
        // Search completed
        if (state.streams.length === 0) {
          container.child(
            Card()
              .title("Онлайн источники")
              .subtitle("Потоки не найдены для данного медиа.")
              .child(
                Button("Повторить поиск")
                  .variant("secondary")
                  .onClick(() => {
                    runSearch();
                  })
              )
          );
        } else {
          // Found streams list
          const streamsContainer = VStack().spacing(8);

          state.streams.forEach((stream) => {
            streamsContainer.child(
              HStack()
                .spacing(8)
                .alignItems("center")
                .child(
                  VStack()
                    .spacing(2)
                    .child(Text(`[${stream.quality}] ${stream.voice}`).bold(true))
                    .child(Text(stream.label).variant("secondary").size("xs"))
                )
                .child(Spacer())
                .child(
                  Button("Смотреть")
                    .variant("primary")
                    .onClick(() => {
                      playStream(stream);
                    })
                )
            );
          });

          container.child(
            Card()
              .title("Онлайн источники")
              .subtitle("Найденные видеопотоки VideoDB Cloud:")
              .child(streamsContainer)
          );
        }
      }

      return container;
    };

    let activeLayout = buildLayout();

    state.$subscribe(() => {
      activeLayout = buildLayout();
      PotokSDK.ui.render(activeLayout);
    });

    // Render immediately to show the "Смотреть Онлайн" button straight away
    PotokSDK.ui.render(activeLayout);

    return {
      label: "Смотреть Онлайн",
      layout: activeLayout
    };
  }
});
