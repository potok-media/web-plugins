import { PotokSDK } from 'potok-sdk';

// Full translations for the potok-torrents namespace. Side-effect module: imported once from index.js before
// the stream source registers (its `name` reads i18n at registration time).
PotokSDK.i18n.registerTranslations({
  en: {
    "potok-torrents": {
      manifest: {
        name: "Torrent Search",
        watch: "Watch",
        statusTitle: "Torrents Status"
      },
      config: {
        torrentGoUrl: "TorrentGo Address",
        searchEngineUrl: "SearchEngine Address",
        jacredUrl: "JacRed API URL",
        jacredApiKey: "JacRed API Key (optional)"
      },
      errors: {
        noSearchUrl: "SearchEngine address is not configured.",
        noTorrUrl: "TorrentGo address is not configured.",
        torrGoError: "TorrentGo error (status {{status}})",
        noMediaFiles: "No supported media files found in the torrent.",
        noJacredUrl: "JacRed API URL is not configured.",
        noJacredApiKey: "JacRed API key is not configured.",
        jacredError: "JacRed error (status {{status}})",
        jacredParseError: "Failed to parse JacRed response."
      },
      sources: {
        jacred: "JacRed"
      },
      settings: {
        searchSource: "Search source",
        searchSourcePotok: "Potok",
        searchSourceJacred: "JacRed",
        searchSourceTitle: "Search Settings"
      },
      status: {
        mediaSearch: "Media Search",
        torrentPlayer: "Torrent Player",
        off: "off",
        offline: "offline"
      },
      ui: {
        seasonNotDetected: "Season not detected",
        correctSeason: "Correct season",
        subtitles: "Subtitles",
        file: "File",
        episode: "Episode",
        serial: "Series",
        video: "Video"
      }
    }
  },
  ru: {
    "potok-torrents": {
      manifest: {
        name: "Поиск торрентов",
        watch: "Смотреть",
        statusTitle: "Статус Торрентов"
      },
      config: {
        torrentGoUrl: "Адрес TorrentGo",
        searchEngineUrl: "Адрес SearchEngine",
        jacredUrl: "JacRed API URL",
        jacredApiKey: "JacRed API Key (необязательно)"
      },
      errors: {
        noSearchUrl: "Адрес поисковика SearchEngine не настроен.",
        noTorrUrl: "Адрес торрент-плеера TorrentGo не настроен.",
        torrGoError: "Ошибка TorrentGo (статус {{status}})",
        noMediaFiles: "В раздаче не найдено поддерживаемых медиафайлов.",
        noJacredUrl: "JacRed API URL не настроен.",
        noJacredApiKey: "JacRed API ключ не настроен.",
        jacredError: "Ошибка JacRed (статус {{status}})",
        jacredParseError: "Не удалось распарсить ответ JacRed."
      },
      sources: {
        jacred: "JacRed"
      },
      settings: {
        searchSource: "Источник поиска",
        searchSourcePotok: "Potok",
        searchSourceJacred: "JacRed",
        searchSourceTitle: "Настройки поиска"
      },
      status: {
        mediaSearch: "Поиск медиа",
        torrentPlayer: "Торрент-плеер",
        off: "выкл",
        offline: "оффлайн"
      },
      ui: {
        seasonNotDetected: "Сезон не определен",
        correctSeason: "Исправить сезон",
        subtitles: "Субтитры",
        file: "Файл",
        episode: "Серия",
        serial: "Сериал",
        video: "Видео"
      }
    }
  }
});
