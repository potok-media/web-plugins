import { PotokSDK } from 'potok-sdk';

const { VStack, HStack, Card, Text, StreamRowComponent, MediaCard, HeroSpotlight, Divider } = PotokSDK.ui.components;

export function buildStreamCard() {
  // 1. Промо-баннер фильма (HeroSpotlight)
  const spotlightBanner = HeroSpotlight()
    .items([
      {
        card: {
          id: 101,
          title: "Интерстеллар",
          subtitle: "Interstellar (2014)",
          mediaType: "movie",
          backdropSrc: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&h=500&q=80",
          overview: "Когда наше время на Земле подходит к концу, группа исследователей отправляется в самую важную экспедицию в истории человечества: путешествие за пределы нашей галактики, чтобы выяснить, есть ли у человечества будущее среди звезд.",
          imdbRating: 8.7,
          kpRating: 8.6,
          genres: "Фантастика, Драма, Приключения",
          ageRating: "12+",
          isInWatchlist: false
        }
      }
    ])
    .onPlay((item) => {})
    .onDetails((item) => {});

  // 2. Карточки фильмов с постерами (MediaCard)
  const moviePosterCard1 = MediaCard()
    .item({
      id: 102,
      title: "Начало",
      subtitle: "Inception (2010)",
      mediaType: "movie",
      posterSrc: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=260&h=380&q=80",
      tmdbRating: 8.8,
      kpRating: 8.7,
      progress: {
        percentage: 65
      }
    })
    .onClick((item) => {});

  const moviePosterCard2 = MediaCard()
    .item({
      id: 103,
      title: "Бегущий по лезвию 2049",
      subtitle: "Blade Runner 2049 (2017)",
      mediaType: "movie",
      posterSrc: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=260&h=380&q=80",
      tmdbRating: 8.0,
      kpRating: 7.8,
      progress: null
    })
    .onClick((item) => {});

  return Card()
    .title("4. Медиа-компоненты фильмов (Spotlight Banner, Media Card & Stream Row)")
    .subtitle("Нативные элементы контента, баннеров и результатов раздач")
    .child(
      VStack()
        .spacing(16)
        .children([
          // А. Промо-баннер фильма
          Text("Cinematic Spotlight (Промо-баннер с главной страницы):").bold(true).variant("primary").size("sm"),
          spotlightBanner,
          
          Divider(),

          // Б. Сетка карточек фильмов с постерами
          Text("Media Cards (Карточки фильмов с постерами, рейтингом и прогрессом):").bold(true).variant("primary").size("sm"),
          HStack()
            .spacing(16)
            .children([
              moviePosterCard1,
              moviePosterCard2
            ]),

          Divider(),

          // В. Торрент-раздача
          Text("Torrent Stream Row (Элемент списка раздач):").bold(true).variant("primary").size("sm"),
          StreamRowComponent()
            .stream({
              title: "Люди Икс: Начало. Росомаха / X-Men Origins: Wolverine (2009) BDRip 1080p | Лицензия",
              tracker: "Rutracker",
              sizeLabel: "7.9 GB",
              seeders: 245,
              leechers: 12,
              publishDate: "2026-05-15T12:00:00Z",
              tags: [
                { kind: "quality", value: "1080p" },
                { kind: "audio", value: "Дубляж" },
                { kind: "source", value: "BDRip" }
              ]
            })
            .onClick((stream) => {})
        ])
    );
}
