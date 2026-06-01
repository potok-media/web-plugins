import { PotokSDK } from 'potok-sdk';
import { state, togglePopupsCode } from '../state.js';

const { VStack, HStack, Card, Heading, Text, Button, Spacer, Divider, Markdown } = PotokSDK.ui.components;

const docString = `### 💬 Системные поповеры и выбор эпизодов (EpisodeSelectorPopup)

Нативный модальный поповер выбора сезонов, серий и аудиодорожек с поддержкой превью, сетевой пагинации и сохранения переопределений.

#### Использование в коде:

\`\`\`js
// Открыть модальное окно выбора серий
PotokSDK.ui.showEpisodeSelector({
  title: "Выбор озвучки и эпизода",
  episodes: [
    {
      id: "ep-1",
      season: 1,
      episode: 1,
      title: "Главная миссия человечества",
      stillPath: "https://example.com/still.jpg",
      airDate: "2014-11-06"
    }
  ],
  seasons: [
    { seasonNumber: 1, name: "Сезон 1", episodesCount: 1 }
  ],
  seasonsLoading: false,
  isSaving: false,
  tmdbSeasonsCount: 1,
  onPlay: (payload) => {
    // запустить видеоплеер
  },
  onClose: () => {
    // закрыть окно
  }
})
\`\`\`
`;

export function buildPopupsCard(setPopupOpen) {
  const childrenList = [
    HStack()
      .spacing(8)
      .alignItems("center")
      .children([
        Heading("6. Интерактивные диалоги и поповеры (EpisodeSelectorPopup)").level(3),
        Spacer(),
        Button("</>").variant("ghost").onClick(() => { togglePopupsCode(); })
      ])
  ];

  if (state.showPopupsCode) {
    childrenList.push(Markdown(docString));
    childrenList.push(Divider());
  }

  childrenList.push(
    Text("Этот компонент рендерит премиальный системный интерфейс для выбора seasons, episodes и звуковых дорожек. Плагины могут использовать его для организации структурированных каталогов многосерийных релизов.")
      .variant("secondary"),
    Button("Открыть селектор эпизодов")
      .variant("primary")
      .onClick(() => {
        setPopupOpen(true);
      })
  );

  return Card()
    .subtitle("Модальное окно выбора серий, сезонов и аудиодорожек")
    .child(
      VStack()
        .spacing(12)
        .children(childrenList)
    );
}
