import { PotokSDK } from '../sdk.js';
import { VideoDBProvider } from './providers/videodb.js';
import { LiftProvider } from './providers/lift.js';
import { KinotochkaProvider } from './providers/kinotochka.js';

const { Card, VStack, HStack, Text, Input, Button, Spacer, Badge, Divider, Select } = PotokSDK.ui.components;
const videoDB = new VideoDBProvider();
const lift = new LiftProvider();
const kinotochka = new KinotochkaProvider();

// 1. Register main plugin metadata in host
PotokSDK.registerPlugin({
  id: "potok-online-balancer",
  name: "Модульные Онлайн Источники",
  version: "2.0.0",
  description: "Клиентский порт Go-движка онлайн-балансеров (VideoDB, Lift, Киноточка)"
});

// 2. Register lookup provider search engines in host registry
PotokSDK.registerSource({
  id: videoDB.id,
  name: videoDB.name,
  supportedTypes: ["movie", "tv"],
  lookup: (query) => videoDB.search(query)
});

PotokSDK.registerSource({
  id: lift.id,
  name: lift.name,
  supportedTypes: ["movie", "tv"],
  lookup: (query) => lift.search(query)
});

PotokSDK.registerSource({
  id: kinotochka.id,
  name: kinotochka.name,
  supportedTypes: ["movie", "tv"],
  lookup: (query) => kinotochka.search(query)
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
      PotokSDK.ui.render(settingsLayout, "online-balancer-settings");
    });

    // Render immediately to prevent blank tab during load, then load stored key
    PotokSDK.ui.render(settingsLayout, "online-balancer-settings");

    PotokSDK.storage.local.getItem("videodb_key").then(key => {
      if (key) {
        state.apiKey = key;
        PotokSDK.ui.render(settingsLayout, "online-balancer-settings");
      }
    });

    return {
      label: "Онлайн балансеры",
      icon: "Sliders",
      layout: settingsLayout
    };
  }
});

// 4. Media Online Streams Search slot contribution
PotokSDK.registerSlotContribution({
  slotName: "media-online-streams",
  id: "online-balancer-search",
  render(props) {
    const { mediaId, mediaType, season, episode, title, originalTitle, kpId, imdbId, progress, numberOfSeasons } = props;

    // Detect initial season/episode based on progress or default to 1
    let initSeason = season;
    let initEpisode = episode;
    if (mediaType === "tv" && (!initSeason || !initEpisode)) {
      if (progress && progress.watchedEpisodes && progress.watchedEpisodes.length > 0) {
        // Sort watched episodes to find the latest
        const sorted = [...progress.watchedEpisodes].sort((a, b) => {
          if (a.season !== b.season) return b.season - a.season;
          return b.number - a.number;
        });
        const latest = sorted[0];
        initSeason = latest.season;
        initEpisode = latest.number + 1; // Try next episode
      } else {
        initSeason = 1;
        initEpisode = 1;
      }
    }

    // React state inside sandbox
    const state = PotokSDK.createState({
      streams: [],
      loading: true,
      qualityFilter: "all",
      providerFilter: "all",
      error: "",
      // TV Series browsing states
      selectedSeason: initSeason || 1,
      selectedEpisode: initEpisode || 1,
      availableEpisodes: [], // synced from TMDB: [{ episodeNumber: 1, name: "Серия 1" }, ...]
      loadingEpisodes: false
    });

    const loadTvSeasonMetadata = async (targetSeason) => {
      if (mediaType !== "tv") return;
      state.loadingEpisodes = true;
      try {
        const res = await PotokSDK.http.get(`/api/media/tmdb/tv/${mediaId}/season/${targetSeason}`);
        if (res && res.status === 200) {
          const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          if (data && data.episodes) {
            state.availableEpisodes = data.episodes.map(ep => ({
              label: `Серия ${ep.episodeNumber}: ${ep.name || `Эпизод ${ep.episodeNumber}`}`,
              value: ep.episodeNumber
            }));
            
            // Adjust selected episode if it's out of bounds
            if (!data.episodes.some(ep => ep.episodeNumber === state.selectedEpisode)) {
              state.selectedEpisode = data.episodes[0] ? data.episodes[0].episodeNumber : 1;
            }
          }
        }
      } catch (err) {
        console.warn("[OnlineBalancer] Failed to fetch TMDB season metadata:", err);
        // Fallback generic episode list if TMDB request fails
        const fallbackList = [];
        for (let i = 1; i <= 30; i++) {
          fallbackList.push({ label: `Серия ${i}`, value: i });
        }
        state.availableEpisodes = fallbackList;
      } finally {
        state.loadingEpisodes = false;
      }
    };

    const runSearch = async () => {
      state.loading = true;
      state.streams = [];
      state.error = "";

      const queryType = mediaType === "tv" ? "tv" : "movie";
      const query = {
        type: queryType,
        tmdbId: mediaId,
        season: mediaType === "tv" ? state.selectedSeason : undefined,
        episode: mediaType === "tv" ? state.selectedEpisode : undefined,
        kpId,
        imdbId
      };

      try {
        // Query providers in parallel
        const results = await Promise.all([
          videoDB.search(query).catch(err => { console.error(err); return []; }),
          lift.search(query).catch(err => { console.error(err); return []; }),
          kinotochka.search(query).catch(err => { console.error(err); return []; })
        ]);

        // Flatten all streams
        state.streams = results.flat();
      } catch (err) {
        state.error = "Ошибка при поиске онлайн-источников.";
      } finally {
        state.loading = false;
      }
    };

    const getProviderName = (providerId) => {
      switch (providerId) {
        case "videodb": return "VideoDB Cloud";
        case "lift": return "Lift";
        case "kinotochka": return "Киноточка";
        default: return providerId;
      }
    };

    // React to state changes and re-render slot dynamically
    state.$subscribe(() => {
      PotokSDK.ui.render(compileLayout(), "online-balancer-search");
    });

    // Run initial search
    if (mediaType === "tv") {
      loadTvSeasonMetadata(state.selectedSeason).then(() => {
        runSearch();
      });
    } else {
      runSearch();
    }

    function compileLayout() {
      // 1. Quality options
      const uniqueQualities = Array.from(new Set(state.streams.map(s => s.quality).filter(Boolean)));
      const qualityOptions = [
        { label: "Все качества", value: "all" },
        ...uniqueQualities.map(q => ({ label: q, value: q }))
      ];

      // 2. Provider options
      const uniqueProviders = Array.from(new Set(state.streams.map(s => s.provider).filter(Boolean)));
      const providerOptions = [
        { label: "Все балансеры", value: "all" },
        ...uniqueProviders.map(p => ({ label: getProviderName(p), value: p }))
      ];

      // 3. Filtered streams
      const filtered = state.streams.filter(s => {
        const qMatch = state.qualityFilter === "all" || s.quality === state.qualityFilter;
        const pMatch = state.providerFilter === "all" || s.provider === state.providerFilter;
        return qMatch && pMatch;
      });

      const headerActions = HStack()
        .spacing(12)
        .alignItems("center")
        .child(
          Select("balancer_select")
            .label("Балансер")
            .options(providerOptions)
            .selected(state.providerFilter)
            .onChange((val) => {
              state.providerFilter = val;
            })
        )
        .child(
          Select("quality_select")
            .label("Качество")
            .options(qualityOptions)
            .selected(state.qualityFilter)
            .onChange((val) => {
              state.qualityFilter = val;
            })
        )
        .child(
          Button("Обновить")
            .variant("secondary")
            .onClick(() => {
              runSearch();
            })
        );

      const header = HStack()
        .justifyContent("between")
        .alignItems("center")
        .child(
          Text(`Потоков: ${filtered.length}`)
            .bold(true)
            .size("lg")
        )
        .child(headerActions);

      const resultsList = VStack().spacing(12);

      // Add TV episode/season selector if TV series
      if (mediaType === "tv") {
        const numSeasons = numberOfSeasons || 1;
        const seasonOptions = [];
        for (let i = 1; i <= numSeasons; i++) {
          seasonOptions.push({ label: `${i} Сезон`, value: i });
        }

        const tvSelectorRow = HStack()
          .spacing(12)
          .alignItems("center")
          .child(
            Select("tv_season_select")
              .label("Сезон")
              .options(seasonOptions)
              .selected(state.selectedSeason)
              .onChange(async (val) => {
                const newSeason = parseInt(val, 10);
                state.selectedSeason = newSeason;
                state.selectedEpisode = 1; // Default to ep 1 of new season
                await loadTvSeasonMetadata(newSeason);
                runSearch();
              })
          )
          .child(
            Select("tv_episode_select")
              .label("Серия")
              .options(state.availableEpisodes.length > 0 ? state.availableEpisodes : [{ label: `Серия ${state.selectedEpisode}`, value: state.selectedEpisode }])
              .selected(state.selectedEpisode)
              .disabled(state.loadingEpisodes)
              .onChange((val) => {
                const newEpisode = parseInt(val, 10);
                state.selectedEpisode = newEpisode;
                runSearch();
              })
          );

        resultsList.child(
          Card()
            .title("Навигация по сериям")
            .subtitle("Выберите сезон и серию для воспроизведения онлайн.")
            .child(tvSelectorRow)
        );
      }

      if (state.loading) {
        // Skeleton loaders using simple cards
        resultsList.child(Card().subtitle("Поиск потоков... Загрузка..."));
      } else if (filtered.length > 0) {
        filtered.forEach((s, idx) => {
          const cardLayout = HStack()
            .justifyContent("between")
            .alignItems("center")
            .child(
              VStack()
                .spacing(4)
                .child(
                  Text(s.voice || "Оригинальная озвучка")
                    .bold(true)
                    .size("md")
                )
                .child(
                  HStack()
                    .spacing(8)
                    .child(Badge(getProviderName(s.provider)).color("info"))
                    .child(s.label ? Badge(s.label).color("warning") : Spacer())
                    .child(Badge(s.kind.toUpperCase()).color("success"))
                )
            )
            .child(
              HStack()
                .spacing(16)
                .alignItems("center")
                .child(Badge(s.quality).color("info"))
                .child(
                  Button("Смотреть")
                    .variant("primary")
                    .onClick(() => {
                      PotokSDK.ui.playVideo({
                        streamUrl: s.url,
                        streamType: s.kind === "mp4" ? "mp4" : "m3u8",
                        title: `${title || "Видео"} (${s.voice})`,
                        mediaType: mediaType === "tv" ? "tv" : "movie",
                        id: mediaId,
                        season: mediaType === "tv" ? state.selectedSeason : undefined,
                        episode: mediaType === "tv" ? state.selectedEpisode : undefined,
                        audios: s.audios,
                        headers: s.headers
                      });
                      PotokSDK.ui.showHUD("success", `Запуск воспроизведения: ${s.voice}`);
                    })
                )
            );

          resultsList.child(
            Card().child(cardLayout)
          );
        });
      } else {
        resultsList.child(
          Card()
            .title("Источники не найдены")
            .subtitle("Попробуйте обновить поиск или изменить фильтры.")
        );
      }

      return VStack()
        .spacing(16)
        .child(header)
        .child(Divider())
        .child(resultsList);
    }

    return {
      label: "Онлайн просмотр",
      layout: compileLayout()
    };
  }
});
