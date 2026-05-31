import { PotokSDK } from '../sdk.js';
import { fetchOnlineEpisodes } from '../utils/episodes.js';

const { Card, VStack, HStack, Text, Divider, Select, StreamSkeletonList, StreamRowComponent, Button } = PotokSDK.ui.components;

export function registerStreamsSlot(videoDB, lift, kinotochka) {
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
              .options(providerOptions)
              .selected(state.providerFilter)
              .onChange((val) => {
                state.providerFilter = val;
              })
          )
          .child(
            Select("quality_select")
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
            Text(`Онлайн-источники: ${filtered.length}`)
              .bold(true)
              .size("lg")
          )
          .child(headerActions);

        const resultsList = VStack().spacing(12);

        if (state.loading) {
          resultsList.child(StreamSkeletonList());
        } else if (filtered.length > 0) {
          filtered.forEach((s, idx) => {
            // Extract voice names uniquely
            const voiceNames = new Set();

            if (s.audios && Array.isArray(s.audios)) {
              s.audios.forEach(a => {
                if (a && a.name) {
                  voiceNames.add(a.name.trim());
                }
              });
            }

            if (s.voice && typeof s.voice === 'string') {
              let voiceStr = s.voice.trim();
              if (voiceStr.includes("Мультиаудио")) {
                const parenMatch = voiceStr.match(/\(([^)]+)\)/);
                if (parenMatch) {
                  voiceStr = parenMatch[1];
                } else {
                  voiceStr = voiceStr.replace(/^Мультиаудио\s*/, "");
                }
              }
              
              voiceStr.split(/[,;]+/).forEach(part => {
                const trimmed = part.trim();
                if (trimmed && trimmed.toLowerCase() !== "мультиаудио") {
                  voiceNames.add(trimmed);
                }
              });
            }

            // Fallback to "Русский" if no voice names could be extracted
            if (voiceNames.size === 0) {
              voiceNames.add("Русский");
            }

            const voiceTags = Array.from(voiceNames).map(name => {
              const nameLower = name.toLowerCase();
              let emoji = "🎙️"; // default voice/dub
              if (nameLower.includes("original") || nameLower.includes("japan") || nameLower.includes("eng")) {
                if (nameLower.includes("sub") || nameLower.includes("суб")) {
                  emoji = "💬";
                } else {
                  emoji = "🌐";
                }
              } else if (nameLower.includes("sub") || nameLower.includes("суб")) {
                emoji = "💬";
              }
              return { value: `${emoji} ${name}` };
            });

            const torrentObj = {
              title: getProviderName(s.provider),
              sizeLabel: s.quality,
              tracker: `${getProviderName(s.provider)} (Онлайн)`,
              tags: [
                s.kind ? { value: `⚡ ${s.kind.toUpperCase()}` } : null,
                (mediaType !== "tv" && s.label) ? { value: s.label } : null,
                ...voiceTags
              ].filter(Boolean),
              publishDate: null,
              seeders: null,
              leechers: null
            };

            resultsList.child(
              StreamRowComponent()
                .torrent(torrentObj)
                .onClick(() => {
                  if (mediaType === "tv") {
                    PotokSDK.ui.showHUD("info", "Загрузка серий с балансера...");
                    fetchOnlineEpisodes(s.provider, { id: mediaId, progress, numberOfSeasons }).then((refinedFiles) => {
                      if (!refinedFiles || refinedFiles.length === 0) {
                        PotokSDK.ui.showHUD("error", "Не удалось найти серии для этого источника.");
                        return;
                      }
                      PotokSDK.ui.showEpisodeSelector({
                        title: `Серии онлайн: ${getProviderName(s.provider)}`,
                        episodes: refinedFiles,
                        tmdbSeasonsCount: numberOfSeasons,
                        onPlay: (episode, audioId) => {
                          const file = refinedFiles.find(f => f.season === episode.season && f.episode === episode.episode);
                          if (file) {
                            const defaultAudio = file.audios && file.audios.length > 0 ? file.audios[0] : null;
                            const finalUrl = defaultAudio ? defaultAudio.url : file.url;
                            const finalVoiceName = defaultAudio ? defaultAudio.name : "Основной поток";

                            PotokSDK.ui.playVideo({
                              streamUrl: finalUrl,
                              streamType: finalUrl.includes(".m3u8") ? "m3u8" : finalUrl.includes(".mpd") ? "dash" : "mp4",
                              title: `${title || "Серия"} - S${file.season}E${file.episode} (${finalVoiceName})`,
                              mediaType: "tv",
                              id: mediaId,
                              season: file.season,
                              episode: file.episode,
                              audios: file.audios, // Expose all voice tracks inside the player!
                              headers: file.headers
                            });
                          }
                        },
                        onStartEditing: () => {
                          PotokSDK.ui.showEpisodeSelector({ seasonsLoading: true });
                          const loadSeasons = async () => {
                            try {
                              const detailsRes = await PotokSDK.http.get(`/api/media/detail/tv/${mediaId}`);
                              if (detailsRes.status !== 200) return [];
                              const details = typeof detailsRes.data === 'string' ? JSON.parse(detailsRes.data) : detailsRes.data;
                              const totalSeasons = details.numberOfSeasons || 1;
                              const promises = [];
                              for (let i = 1; i <= totalSeasons; i++) {
                                promises.push(
                                  PotokSDK.http.get(`/api/media/tmdb/tv/${mediaId}/season/${i}`)
                                    .then(res => {
                                      if (res.status === 200) {
                                        return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
                                      }
                                      return null;
                                    })
                                    .catch(() => null)
                                );
                              }
                              const results = await Promise.all(promises);
                              return results.filter(Boolean);
                            } catch (e) {
                              console.error(e);
                              return [];
                            }
                          };
                          loadSeasons().then(seasons => {
                            PotokSDK.ui.showEpisodeSelector({ seasonsLoading: false, seasons });
                          });
                        },
                        onApplyOverride: (seasonNum, epNum) => {
                          PotokSDK.ui.showEpisodeSelector({ isSaving: true });
                          const saveOverrideAndReload = async () => {
                            try {
                              const deterministicHash = `online:${s.provider}:${mediaId}`;
                              const episodeOffset = epNum - 1;
                              const body = {
                                hash: deterministicHash,
                                override: {
                                  season: seasonNum,
                                  episodeOffset
                                }
                              };
                              const saveRes = await PotokSDK.http.post("/api/media/override", body);
                              if (saveRes.status === 200 || saveRes.status === 204 || saveRes.status === 201) {
                                PotokSDK.ui.showHUD("success", "Смещение серий успешно сохранено!");
                              } else {
                                PotokSDK.ui.showHUD("error", "Не удалось сохранить смещение.");
                              }
                              const newEpisodes = await fetchOnlineEpisodes(s.provider, { id: mediaId, progress, numberOfSeasons });
                              return newEpisodes;
                            } catch (err) {
                              console.error(err);
                              PotokSDK.ui.showHUD("error", "Не удалось применить смещение.");
                              return null;
                            }
                          };
                          saveOverrideAndReload().then(newEpisodes => {
                            const updatePayload = { isSaving: false };
                            if (newEpisodes) {
                              updatePayload.episodes = newEpisodes;
                            }
                            PotokSDK.ui.showEpisodeSelector(updatePayload);
                          });
                        }
                      });
                    }).catch((err) => {
                      console.error("[Plugin] Episode loading failed:", err);
                      PotokSDK.ui.showHUD("error", "Не удалось получить список серий.");
                    });
                  } else {
                    PotokSDK.ui.playVideo({
                      streamUrl: s.url,
                      streamType: s.kind === "mp4" ? "mp4" : "m3u8",
                      title: title || "Видео",
                      mediaType: "movie",
                      id: mediaId,
                      audios: s.audios,
                      headers: s.headers
                    });
                  }
                })
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
}
