# Potok Online Balancers

Самодостаточный плагин Potok и лёгкий ASP.NET Core Minimal API для онлайн-источников фильмов, сериалов и аниме:

- AniLiberty;
- Kodik;
- AnimeGo;
- VideoHUB;
- LeProduction;
- VeoVeo;
- Alloha (аккаунт пользователя);
- KinoWatch (KinoPub, аккаунт пользователя);
- Rezka (аккаунт пользователя).

`web` для работы плагина менять не требуется. Браузерный код плагина только вызывает этот сервис, а сервис ищет релизы, собирает серии, обновляет временные ссылки и проксирует HLS вместе с нужными `Origin`/`Referer`.

## Аккаунты платных источников

Используются исключительно собственные аккаунты пользователя. Данные аккаунтов постоянно хранятся только в изолированном `PotokSDK.storage.local` самого плагина и прикладываются только к запросу выбранного провайдера.

- backend не имеет хранилища аккаунтов, cookie jar или кэша учётных данных;
- пароль Rezka передаётся один раз для входа, не записывается в browser storage и не возвращается клиенту;
- после входа локально сохраняется только выданная сессия Rezka;
- KinoWatch (KinoPub) подключается штатным device-code flow;
- токены Alloha вводятся пользователем и остаются в локальном хранилище плагина;
- stream URL и необходимые upstream-заголовки выдаются плееру в короткоживущем AES-GCM ticket, поэтому cookie и токены не попадают в URL открытым текстом.

## Быстрый запуск

Из клонированного репозитория:

```bash
./online-balancers/install.sh
```

На чистой Linux/macOS-машине одной командой:

```bash
curl -fsSL https://raw.githubusercontent.com/potok-media/web-plugins/main/online-balancers/install.sh | bash
```

Скрипт проверит Docker, при необходимости установит его, скачает или обновит `web-plugins`, соберёт образ и выполнит `docker compose up -d`. Если в локальном checkout есть незакоммиченные изменения, `git pull` безопасно пропускается.

После запуска добавьте в Potok URL каталога плагина:

```text
http://SERVER:8090/plugin
```

Манифест доступен по `http://SERVER:8090/plugin/manifest.json`, healthcheck — по `http://SERVER:8090/healthz`. Настраивать ключи, домены или параметры балансеров не требуется.

## Обычный Docker Compose

```bash
docker compose up -d --build
```

Остановить сервис:

```bash
docker compose down
```

Посмотреть состояние:

```bash
docker compose ps
docker compose logs -f online-balancers
```

## Разработка и проверка

Нужны .NET SDK 10 и Node.js:

```bash
dotnet run --project tests/OnlineBalancers.Tests/OnlineBalancers.Tests.csproj
npm test
```

Браузерная часть разбита по зонам ответственности: `search`, `episodes`, `playback`, `routing`, `ui`, `api` и `sources`. Источники декларируются отдельно в `plugin/sources`, но поиск, разбор страниц и получение реальных stream URL остаются только на backend.

Чтобы добавить новый online-источник, создайте реализацию `IOnlineProvider` в `src/OnlineBalancers/Providers` и соответствующий декларативный файл в `plugin/sources`. Backend подхватит реализацию провайдера автоматически; browser registry определяет порядок и доступность источника в интерфейсе. Пользовательские строки находятся в `plugin/i18n.js`.

Сервис локально без Docker:

```bash
dotnet run --project src/OnlineBalancers/OnlineBalancers.csproj --urls http://127.0.0.1:8090
```

Основной API построен вокруг `/api/v1/search`, `/api/v1/episodes`, `/api/v1/playback` и `/api/v1/refresh`. Для request-local подключения аккаунтов доступны отдельные ручки KinoWatch (KinoPub) device-code и Rezka login; они ничего не сохраняют на сервере. Адреса внешних HLS не отдаются плееру напрямую: сервис выдаёт зашифрованный `/stream/...`, переписывает вложенные manifest/segment/key URL и передаёт upstream-заголовки.
