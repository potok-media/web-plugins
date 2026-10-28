using System.Net;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Template;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Caching.Memory;
using OnlineBalancers;
using OnlineBalancers.Providers;

var tests = new (string Name, Func<Task> Run)[]
{
    ("AniLiberty maps search, episodes and the best HLS quality", AniLibertyContract),
    ("AnimeGo exposes translations and resolves an HLS stream", AnimeGoContract),
    ("AnimeGo supports the current player/videos contract", AnimeGoCurrentContract),
    ("Kodik maps API seasons and decodes player streams", KodikContract),
    ("Kodik supports the current spaced bootstrap contract", KodikCurrentPlayerContract),
    ("KinoPub uses a request account for search, episodes and audio selection", KinoPubContract),
    ("KinoWatch device flow exposes the current activation domain", KinoWatchDeviceFlowContract),
    ("Alloha keeps account tokens request-scoped across search and playback", AllohaContract),
    ("Rezka uses the local account session for episodes and playback headers", RezkaContract),
    ("Encrypted tickets are not split by media extension routes", EncryptedTicketRouteContract),
    ("Provider search isolates failures and honors the requested source set", ProviderSearchContract),
    ("Provider search removes irrelevant title matches", ProviderSearchRelevanceContract),
    ("Provider search respects its concurrency bound", ProviderSearchConcurrencyContract),
    ("Provider search propagates request cancellation", ProviderSearchCancellationContract),
    ("Episode and playback services share signed provider selections", ApplicationServicesContract),
    ("Encrypted stream tickets hide credentials and reject replay variants", EncryptedTicketContract),
    ("Paid provider accounts are scoped and field-allowlisted", ProviderAccountContract),
    ("Service registration discovers all backend providers", ProviderDiscoveryContract),
    ("Plugin asset serving rejects traversal and identifies module content", PluginAssetsContract),
};

var failures = new List<string>();
foreach (var test in tests)
{
    try
    {
        await test.Run();
        Console.WriteLine($"PASS {test.Name}");
    }
    catch (Exception exception)
    {
        failures.Add($"FAIL {test.Name}\n{exception}");
    }
}

if (failures.Count > 0)
{
    Console.Error.WriteLine(string.Join("\n\n", failures));
    return 1;
}

return 0;

static Task EncryptedTicketRouteContract()
{
    var codec = new EncryptedTicketCodec();
    var ticket = codec.Issue(new StreamTicket("https://cdn.test/segment.ts", null), "stream");
    var extensionRoute = new TemplateMatcher(
        TemplateParser.Parse("stream/{token}.{extension}"),
        new RouteValueDictionary());

    var plainValues = new RouteValueDictionary();
    Equal(false, extensionRoute.TryMatch(new PathString($"/stream/{ticket}"), plainValues));

    var suffixedValues = new RouteValueDictionary();
    Equal(true, extensionRoute.TryMatch(new PathString($"/stream/{ticket}.m3u8"), suffixedValues));
    Equal(ticket, Convert.ToString(suffixedValues["token"]));
    Equal("m3u8", Convert.ToString(suffixedValues["extension"]));
    Equal("https://cdn.test/segment.ts", codec.Read<StreamTicket>(ticket, "stream").Url);
    return Task.CompletedTask;
}

static async Task AniLibertyContract()
{
    var http = FakeHttp.Create(request => request.RequestUri!.AbsolutePath switch
    {
        "/api/v1/app/search/releases" => """
            [{"id":42,"year":2024,"name":{"main":"Тестовое аниме","english":"Test Anime"},"poster":{"src":"/poster.jpg"}}]
            """,
        "/api/v1/anime/releases/42" => """
            {"alias":"test-anime-season-2","name":{"main":"Тестовое аниме 2","english":"Test Anime II"},"episodes":[{"ordinal":1,"name":"Начало","hls_1080":"https://video.anilibria.test/1080.m3u8","hls_720":"https://video.anilibria.test/720.m3u8"}]}
            """,
        _ => throw new InvalidOperationException(request.RequestUri.ToString()),
    });
    var provider = new AniLibertyProvider(http);
    var query = new MediaQuery("tv", "Тестовое аниме", "Test Anime", null, 2024, null, null);

    var search = await provider.SearchAsync(query, default);
    Equal("42", Single(search).SourceId);

    var episodes = await provider.GetEpisodesAsync(new SourceSelection("42", query), default);
    var episode = Single(episodes.Episodes);
    Equal(2, episode.Season);
    Equal(1d, episode.Number);

    var playback = await provider.ResolveAsync(new PlaybackSelection("42", query, 2, 1, null, episode.Locator), default);
    Equal("https://video.anilibria.test/1080.m3u8", playback.Url);
    Equal("1080p", playback.Quality);
}

static async Task AnimeGoContract()
{
    const string searchHtml = """
        <div class="p-poster__stack" data-ajax-url="/anime/test-777"><div class="card-title text-truncate"><a href="/x">Тестовое аниме</a></div><div class="anime-year"><a>2024</a></div><img data-original="https://img.test/poster.jpg"></div>
        """;
    const string playerContent = """
        <div data-player="//aniboom.one/embed/token-1?episode=1&amp;translation=10" data-provider="1" data-provide-dubbing="100" data-episode="1"></div>
        <div data-player="//aniboom.one/embed/token-1?episode=1&amp;translation=20" data-provider="1" data-provide-dubbing="200" data-episode="2"></div>
        <div data-dubbing="100"><span class="x">
          Дубляж A</span></div><div data-dubbing="200"><span class="x">
          Дубляж B</span></div>
        """;
    var http = FakeHttp.Create(request => request.RequestUri!.Host == "animego.me" && request.RequestUri.AbsolutePath == "/search/anime"
        ? searchHtml
        : request.RequestUri.Host == "animego.me" && request.RequestUri.AbsolutePath == "/player/777"
            ? "not-json"
        : request.RequestUri.Host == "animego.me" && request.RequestUri.AbsolutePath == "/anime/777/player"
            ? System.Text.Json.JsonSerializer.Serialize(new { content = playerContent })
            : request.RequestUri.Host == "aniboom.one"
                ? """<script>window.data={"hls":"{\"src\":\"//cdn.test/master.m3u8\"}"};</script>"""
                : throw new InvalidOperationException(request.RequestUri.ToString()));
    var provider = new AnimeGoProvider(http);
    var query = new MediaQuery("tv", "Тестовое аниме", null, null, 2024, null, null);

    var search = await provider.SearchAsync(query, default);
    Equal("777", Single(search).SourceId);

    var episodes = await provider.GetEpisodesAsync(new SourceSelection("777", query), default);
    var episode = episodes.Episodes.First(item => item.Number == 1);
    Equal(2, episode.Audios.Count);

    var playback = await provider.ResolveAsync(new PlaybackSelection("777", query, 1, 1, "Дубляж B", episode.Audios[1].Locator), default);
    Equal("https://cdn.test/master.m3u8", playback.Url);
    Equal("Дубляж B", playback.Voice);
}

static async Task KodikContract()
{
    const string api = """
        {"results":[{"id":"kodik-1","title":"Тестовое аниме","title_orig":"Test Anime","type":"anime-serial","year":2024,"link":"//kodikplayer.com/video/movie-link","last_season":1,"translation":{"title":"Дубляж"},"seasons":{"1":{"episodes":{"1":"//kodikplayer.com/video/episode-link"}}}}]}
        """;
    const string iframe = """
        <script src="/assets/js/app.player_deadbeef.js"></script><script>advertDebug=false;domain="d";d_sign="ds";pd="p";pd_sign="ps";ref="r";ref_sign="rs";vInfo.type='anime';vInfo.hash='h';vInfo.id='i';preview-icons=true;</script>
        """;
    var encodedEndpoint = Convert.ToBase64String(Encoding.UTF8.GetBytes("/get-video"));
    const string encodedStream = "https://cdn.test/manifest.m3u8";
    var http = FakeHttp.Create(request => request.RequestUri!.Host switch
    {
        "kodik-api.com" => api,
        "kodikplayer.com" when request.RequestUri.AbsolutePath.StartsWith("/video/") => iframe,
        "kodikplayer.com" when request.RequestUri.AbsolutePath.Contains("app.player") => $"type:\"POST\",url:atob(\"{encodedEndpoint}\")",
        "kodikplayer.com" when request.RequestUri.AbsolutePath == "/get-video" => $"{{\"720\":[{{\"src\":\"{encodedStream}\"}}]}}",
        _ => throw new InvalidOperationException(request.RequestUri.ToString()),
    });
    var provider = new KodikProvider(http);
    var query = new MediaQuery("tv", "Тестовое аниме", "Test Anime", "tt123", 2024, null, null);

    var search = await provider.SearchAsync(query, default);
    var source = Single(search);
    Equal("kodik-1", source.SourceId);

    var episodes = await provider.GetEpisodesAsync(new SourceSelection(source.SourceId, query), default);
    var episode = Single(episodes.Episodes);
    Equal(1, episode.Season);
    Equal(1d, episode.Number);

    var playback = await provider.ResolveAsync(new PlaybackSelection(source.SourceId, query, 1, 1, "Дубляж", episode.Locator), default);
    Equal("https://cdn.test/manifest.m3u8", playback.Url);
    Equal("720p", playback.Quality);
}

static async Task AnimeGoCurrentContract()
{
    const string searchHtml = """
        <div class="ani-grid__item">
          <a class="ani-grid__item-picture" href="/anime/test-anime-777"><img src="https://img.test/current.jpg" alt="Тестовое аниме"></a>
          <div class="fw-lighter small">Test Anime</div>
          <div class="ani-grid__item-title"><a href="/anime/test-anime-777">Тестовое аниме</a></div>
          <div class="ani-grid__item-genres"><span>Сериал</span><span>2024</span></div>
        </div>
        """;
    const string playerHtml = """
        <div data-anime-player-episodes-total-value="2" data-anime-player-episodes-page-size-value="100">
          <div data-episode-number="1" data-episode-page="0" data-episode="5001"></div>
          <div data-episode-number="2" data-episode-page="0" data-episode="5002"></div>
        </div>
        """;
    const string videoHtml = """
        <button data-player="//kodikplayer.com/video/current-link" data-provider-slug="kodik" data-translation-id="20" data-translation-title="Дубляж B"></button>
        """;
    const string iframe = """
        <script src="/assets/js/app.player_deadbeef.js"></script><script>advertDebug=false;domain="d";d_sign="ds";pd="p";pd_sign="ps";ref="r";ref_sign="rs";vInfo.type='anime';vInfo.hash='h';vInfo.id='i';preview-icons=true;</script>
        """;
    var encodedEndpoint = Convert.ToBase64String(Encoding.UTF8.GetBytes("/get-video"));
    var http = FakeHttp.Create(request => (request.Method.Method, request.RequestUri!.Host, request.RequestUri.AbsolutePath) switch
    {
        ("GET", "animego.me", "/search/anime") => searchHtml,
        ("GET", "animego.me", "/player/777") => System.Text.Json.JsonSerializer.Serialize(new { status = "success", data = new { content = playerHtml } }),
        ("GET", "animego.me", "/player/videos/5001") => System.Text.Json.JsonSerializer.Serialize(new { status = "success", data = new { content = videoHtml } }),
        ("GET", "kodikplayer.com", "/video/current-link") => iframe,
        ("GET", "kodikplayer.com", "/assets/js/app.player_deadbeef.js") => $"type:\"POST\",url:atob(\"{encodedEndpoint}\")",
        ("POST", "kodikplayer.com", "/get-video") => "{\"720\":[{\"src\":\"https://cdn.test/current.m3u8\"}]}",
        _ => throw new InvalidOperationException(request.RequestUri.ToString()),
    });
    var provider = new AnimeGoProvider(http);
    var query = new MediaQuery("tv", "Тестовое аниме", "Test Anime", null, 2024, null, null);

    var source = Single(await provider.SearchAsync(query, default));
    Equal("777", source.SourceId);
    Equal("Test Anime", source.OriginalTitle);

    var episodes = await provider.GetEpisodesAsync(new SourceSelection("777", query), default);
    Equal(2, episodes.Episodes.Count);
    var episode = episodes.Episodes[0];
    Equal(1d, episode.Number);

    var playback = await provider.ResolveAsync(new PlaybackSelection("777", query, 1, 1, null, episode.Locator), default);
    Equal("https://cdn.test/current.m3u8", playback.Url);
    Equal("Дубляж B", playback.Voice);
}

static async Task KodikCurrentPlayerContract()
{
    const string iframe = """
        <script src="/assets/js/app.player_single.currenthash.js"></script>
        <script>
          var domain = "anilib.me";
          var d_sign = "ds";
          var pd = "kodikplayer.com";
          var pd_sign = "ps";
          var ref = "https://anilib.me/";
          var ref_sign = "rs";
          var vInfo = {};
          vInfo.type = 'seria';
          vInfo.hash = 'h';
          vInfo.id = 'i';
        </script>
        """;
    var encodedEndpoint = Convert.ToBase64String(Encoding.UTF8.GetBytes("/ftor"));
    var http = FakeHttp.Create(request => (request.Method.Method, request.RequestUri!.AbsolutePath) switch
    {
        ("GET", "/seria/current") => iframe,
        ("GET", "/assets/js/app.player_single.currenthash.js") => $"type:\"POST\",url:atob(\"{encodedEndpoint}\")",
        ("POST", "/ftor") => "{\"links\":{\"1080\":[{\"src\":\"https://cdn.test/current-master.m3u8\"}]}}",
        _ => throw new InvalidOperationException(request.RequestUri.ToString()),
    });

    var streams = await new KodikPlayerResolver(http).ResolveAsync(
        "https://kodikplayer.com/seria/current",
        "https://anilib.me/",
        default);

    Equal("https://cdn.test/current-master.m3u8", Single(streams).Url);
    Equal(1080, streams[0].Height);
}

static async Task KinoPubContract()
{
    const string item = """
        {"item":{"id":55,"title":"Test Series","seasons":[{"number":1,"episodes":[{"number":1,"audios":[{"index":1,"author":{"title":"Dub A"}},{"index":2,"author":{"title":"Dub B"}}],"files":[{"quality":"1080p","url":{"hls":"https://cdn.test/a1.m3u8"}}]}]}]}}
        """;
    var http = FakeHttp.Create(request => request.RequestUri!.AbsolutePath switch
    {
        "/v1/items/search" => """
            {"items":[{"id":55,"title":"Test Series","original_title":"Original","year":2025,"type":"serial","quality":1080,"posters":{"big":"https://img.test/poster.jpg"}}]}
            """,
        "/v1/items/55" => item,
        _ => throw new InvalidOperationException(request.RequestUri.ToString()),
    });
    using var cache = new MemoryCache(new MemoryCacheOptions());
    var provider = new KinoPubProvider(http, cache);
    var context = ProviderRequestContext.For(provider, new ProviderAccount("kinopub",
        new Dictionary<string, string> { ["accessToken"] = "private-access" }));
    var query = new MediaQuery("tv", "Test Series", "Original", null, 2025, null, null);

    var source = Single(await provider.SearchAsync(query, context, default));
    Equal("55", source.SourceId);
    var episodes = await provider.GetEpisodesAsync(new SourceSelection(source.SourceId, query), context, default);
    var episode = Single(episodes.Episodes);
    Equal(2, episode.Audios.Count);
    var playback = await provider.ResolveAsync(
        new PlaybackSelection(source.SourceId, query, 1, 1, "Dub B", episode.Audios[1].Locator),
        context,
        default);
    Equal("https://cdn.test/a2.m3u8", playback.Url);
    Equal("Dub B", playback.Voice);
    Equal(0, cache.Count);
}

static async Task KinoWatchDeviceFlowContract()
{
    string? requestedHost = null;
    var http = FakeHttp.Create(request =>
    {
        requestedHost = request.RequestUri!.Host;
        return """
            {"code":"opaque-device-code","user_code":"ABCD","expires_in":600,"interval":5}
            """;
    });
    var service = new AccountConnectionService(new StubHttpClientFactory(http));

    var response = await service.StartKinoPubAsync(default);

    Equal("https://kino.watch/device", response.VerificationUri);
    Equal("api.srvkp.com", requestedHost);
}

static async Task AllohaContract()
{
    var bearerSeen = false;
    var secretSeenOnlyInDirectRequest = false;
    var http = FakeHttp.Create(request =>
    {
        if (request.RequestUri!.Host == "apbugall.org")
            bearerSeen |= request.Headers.Authorization?.Scheme == "Bearer" && request.Headers.Authorization.Parameter == "api-private";
        if (request.RequestUri.Host == "torso-as.stloadi.live")
            secretSeenOnlyInDirectRequest = request.RequestUri.Query.Contains("secret-private", StringComparison.Ordinal);
        return request.RequestUri.AbsolutePath switch
        {
            "/v2/movies/name/list" => """
                {"data":[{"name":"Test Movie","original_name":"Original","year":2025,"token":"movie-token","poster":"https://img.test/movie.jpg","category":{"slug":"movie"},"translations":[{"id":8,"name":"Dub","quality":"1080p"}]}]}
                """,
            "/v2/movies/token/movie-token" => """
                {"data":{"name":"Test Movie","token":"movie-token","category":{"slug":"movie"},"translations":[{"id":8,"name":"Dub","quality":"1080p"}]}}
                """,
            "/direct" => """
                {"data":{"file":{"hlsSource":[{"default":true,"quality":{"720p":"https://cdn.test/movie-720.m3u8","1080p":"https://cdn.test/movie-1080.m3u8"}}]}}}
                """,
            _ => throw new InvalidOperationException(request.RequestUri.ToString()),
        };
    });
    using var cache = new MemoryCache(new MemoryCacheOptions());
    var provider = new AllohaProvider(http, cache);
    var context = ProviderRequestContext.For(provider, new ProviderAccount("alloha",
        new Dictionary<string, string>
        {
            ["apiToken"] = "api-private",
            ["secretToken"] = "secret-private",
        }));
    var query = new MediaQuery("movie", "Test Movie", "Original", null, 2025, null, null);

    var source = Single(await provider.SearchAsync(query, context, default));
    var playback = await provider.ResolveAsync(
        new PlaybackSelection(source.SourceId, query, null, null, null, null),
        context,
        default);
    Equal(true, bearerSeen);
    Equal(true, secretSeenOnlyInDirectRequest);
    Equal("https://cdn.test/movie-1080.m3u8", playback.Url);
    Equal(0, cache.Count);
}

static async Task RezkaContract()
{
    var cookieSeen = true;
    var http = FakeHttp.Create(request =>
    {
        cookieSeen &= request.Headers.TryGetValues("Cookie", out var cookies) &&
            cookies.Contains("dle_user_id=1; dle_hash=private");
        if (request.Method == HttpMethod.Get)
        {
            return """
                <script>initCDNSeriesEvents(123, 7);</script>
                <ul data-favs="fav"><li data-translator_id="7">Dub</li></ul>
                <li data-season_id="1" data-episode_id="1">Pilot</li>
                """;
        }
        var body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
        if (body.Contains("action=get_episodes", StringComparison.Ordinal))
            return "{\"episodes\":\"<li data-season_id=\\\"1\\\" data-episode_id=\\\"1\\\">Pilot</li>\"}";
        if (body.Contains("action=get_stream", StringComparison.Ordinal))
            return "{\"url\":\"[720p]https://cdn.test/episode-720.m3u8,[1080p]https://cdn.test/episode-1080.m3u8\"}";
        throw new InvalidOperationException(body);
    });
    using var cache = new MemoryCache(new MemoryCacheOptions());
    var provider = new RezkaProvider(http, cache);
    var context = ProviderRequestContext.For(provider, new ProviderAccount("rezka",
        new Dictionary<string, string>
        {
            ["host"] = "https://rezka.ag",
            ["cookie"] = "dle_user_id=1; dle_hash=private",
        }));
    var query = new MediaQuery("tv", "Test Series", null, null, 2025, null, null);
    var selection = new SourceSelection("series/test.html", query);

    var episodes = await provider.GetEpisodesAsync(selection, context, default);
    var episode = Single(episodes.Episodes);
    Equal("Pilot", episode.Title);
    var playback = await provider.ResolveAsync(
        new PlaybackSelection(selection.SourceId, query, 1, 1, episode.Voice, episode.Locator),
        context,
        default);
    Equal(true, cookieSeen);
    Equal("https://cdn.test/episode-1080.m3u8", playback.Url);
    Equal("dle_user_id=1; dle_hash=private", playback.Headers!["Cookie"]);
    Equal(0, cache.Count);
}

static async Task ProviderSearchContract()
{
    var good = new StubProvider("good");
    var broken = new StubProvider("broken", shouldFail: true);
    var unused = new StubProvider("unused");
    var coordinator = new ProviderSearchCoordinator(
        new ProviderRegistry([good, broken, unused]),
        maxConcurrency: 2);

    var response = await coordinator.SearchAsync(
        new MediaQuery("tv", "Anime", null, null, 2024, null, null),
        ["good", "broken", "missing", "good"],
        default);

    Equal(1, response.Items.Count);
    Equal("good", response.Items[0].Provider);
    Equal(true, response.Errors.ContainsKey("broken"));
    Equal(true, response.Errors.ContainsKey("missing"));
    Equal(1, good.SearchCalls);
    Equal(1, broken.SearchCalls);
    Equal(0, unused.SearchCalls);
}

static async Task ProviderSearchRelevanceContract()
{
    var items = new SourceItem[]
    {
        new("catalog", "Catalog", "wrong-person", "Человек, выбранный богами", null, 2023, null, "1080p", null, "movie"),
        new("catalog", "Catalog", "english", "Spider-Man: Brand New Day", null, 2026, null, "1080p", null, "movie"),
        new("catalog", "Catalog", "wrong-day", "День D", null, 2013, null, "720p", null, "movie"),
        new("catalog", "Catalog", "wrong-franchise", "Spider-Man: No Way Home", null, 2021, null, "1080p", null, "movie"),
        new("catalog", "Catalog", "wrong-year", "Человек-паук: Новый день", "Spider-Man: Brand New Day", 2015, null, "1080p", null, "movie"),
        new("catalog", "Catalog", "localized", "Человек-паук: Новый день (2026)", "Spider-Man: Brand New Day", 2026, null, "1080p", null, "movie"),
        new("catalog", "Catalog", "wrong-type", "Человек-паук: Новый день", "Spider-Man: Brand New Day", 2026, null, "720p", null, "tv"),
    };
    var coordinator = new ProviderSearchCoordinator(new ProviderRegistry([
        new StubProvider("catalog", items: items),
    ]));

    var response = await coordinator.SearchAsync(
        new MediaQuery(
            "movie",
            "Человек-паук: Новый день",
            "Spider-Man: Brand New Day",
            null,
            2026,
            1291634,
            null),
        null,
        default);

    Equal(2, response.Items.Count);
    Equal("localized", response.Items[0].SourceId);
    Equal("english", response.Items[1].SourceId);

    var typoCoordinator = new ProviderSearchCoordinator(new ProviderRegistry([
        new StubProvider("catalog", items:
        [
            new("catalog", "Catalog", "typo", "Интерстелар", "Interstellar", 2014, null, "1080p", null, "movie"),
        ]),
    ]));
    var typoResponse = await typoCoordinator.SearchAsync(
        new MediaQuery("movie", "Интерстеллар", null, null, 2014, null, null),
        null,
        default);
    Equal(1, typoResponse.Items.Count);
}

static async Task ProviderSearchConcurrencyContract()
{
    var tracker = new SearchConcurrencyTracker();
    var providers = Enumerable.Range(1, 5)
        .Select(index => (IOnlineProvider)new DelayedProvider($"provider-{index}", tracker))
        .ToArray();
    var coordinator = new ProviderSearchCoordinator(new ProviderRegistry(providers), maxConcurrency: 2);

    var result = await coordinator.SearchAsync(
        new MediaQuery("tv", "Anime", null, null, null, null, null),
        null,
        default);

    Equal(5, result.Items.Count);
    Equal(2, tracker.Maximum);
}

static async Task ProviderSearchCancellationContract()
{
    var provider = new CancellableProvider();
    var coordinator = new ProviderSearchCoordinator(new ProviderRegistry([provider]));
    using var cancellation = new CancellationTokenSource();
    cancellation.Cancel();

    try
    {
        await coordinator.SearchAsync(
            new MediaQuery("tv", "Anime", null, null, null, null, null),
            null,
            cancellation.Token);
        throw new InvalidOperationException("Expected cancellation to propagate.");
    }
    catch (OperationCanceledException)
    {
    }
}

static async Task ApplicationServicesContract()
{
    var provider = new PlaybackStubProvider();
    var registry = new ProviderRegistry([provider]);
    var tickets = new SignedTicketCodec();
    var episodeService = new EpisodeService(registry, tickets);
    var playbackService = new PlaybackService(registry, tickets);
    var query = new MediaQuery("tv", "Anime", null, null, 2024, 42, null);

    var result = await episodeService.GetEpisodesAsync(
        new EpisodesRequest(provider.Id, "source", query),
        "https://plugin.test",
        default);
    var audio = Single(Single(result.Episodes).Audios);
    Equal(true, audio.Url!.StartsWith("https://plugin.test/api/v1/audio/", StringComparison.Ordinal));

    var token = new Uri(audio.Url).Segments[^1];
    var fromAudio = await playbackService.ResolveTicketAsync(token, "https://plugin.test", default);
    Equal(true, fromAudio.StreamUrl.StartsWith("https://plugin.test/stream/", StringComparison.Ordinal));
    Equal("Dub", fromAudio.Voice);

    var refreshed = await playbackService.RefreshAsync(
        new RefreshRequest(fromAudio.Session),
        "https://plugin.test",
        default);
    Equal("m3u8", refreshed.StreamType);
    Equal(2, provider.ResolveCalls);
}

static Task EncryptedTicketContract()
{
    var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-17T00:00:00Z"));
    var codec = new EncryptedTicketCodec(clock);
    var ticket = codec.Issue(
        new StreamTicket("https://cdn.test/video.m3u8?token=private", new Dictionary<string, string>
        {
            ["Cookie"] = "session=secret-cookie",
        }),
        "stream",
        TimeSpan.FromMinutes(1));

    Equal(false, ticket.Contains("private", StringComparison.Ordinal));
    Equal(false, ticket.Contains("secret-cookie", StringComparison.Ordinal));
    Equal("https://cdn.test/video.m3u8?token=private", codec.Read<StreamTicket>(ticket, "stream").Url);
    Throws<ProviderException>(() => codec.Read<StreamTicket>(ticket, "session"));
    Throws<ProviderException>(() => new EncryptedTicketCodec(clock).Read<StreamTicket>(ticket, "stream"));

    var tamperIndex = ticket.IndexOf('_') + 1;
    var tampered = ticket[..tamperIndex]
        + (ticket[tamperIndex] == 'A' ? 'B' : 'A')
        + ticket[(tamperIndex + 1)..];
    Throws<ProviderException>(() => codec.Read<StreamTicket>(tampered, "stream"));
    clock.Advance(TimeSpan.FromMinutes(2));
    Throws<ProviderException>(() => codec.Read<StreamTicket>(ticket, "stream"));
    return Task.CompletedTask;
}

static Task ProviderAccountContract()
{
    var provider = new AllohaProvider(FakeHttp.Create(_ => throw new InvalidOperationException()));
    Throws<ProviderException>(() => ProviderRequestContext.For(provider, null));
    Throws<ProviderException>(() => ProviderRequestContext.For(provider,
        new ProviderAccount("rezka", new Dictionary<string, string> { ["cookie"] = "private" })));

    var account = new ProviderAccount("alloha", new Dictionary<string, string>
    {
        ["apiToken"] = "api",
        ["secretToken"] = "secret",
    });
    var context = ProviderRequestContext.For(provider, account);
    Equal("api", context.RequireAccount("alloha", "apiToken", "secretToken")["apiToken"]);
    Throws<ProviderException>(() => context.RequireAccount("alloha", "apiToken"));
    return Task.CompletedTask;
}

static Task ProviderDiscoveryContract()
{
    var services = new ServiceCollection();
    services.AddOnlineBalancers();
    using var serviceProvider = services.BuildServiceProvider();
    var ids = serviceProvider.GetRequiredService<ProviderRegistry>().All
        .Select(provider => provider.Id)
        .OrderBy(id => id, StringComparer.Ordinal)
        .ToArray();

    Equal("alloha,aniliberty,animego,kinopub,kodik,leproduction,rezka,veoveo,videohub", string.Join(',', ids));
    return Task.CompletedTask;
}

static Task PluginAssetsContract()
{
    var pluginRoot = Path.Combine(AppContext.BaseDirectory, "plugin");
    var indexPath = PluginAssetsEndpoints.ResolveAssetPath(pluginRoot, "index.js");
    Equal(true, indexPath is not null);
    Equal("text/javascript; charset=utf-8", PluginAssetsEndpoints.ContentTypeFor(indexPath!));
    Equal<string?>(null, PluginAssetsEndpoints.ResolveAssetPath(pluginRoot, "../OnlineBalancers.dll"));
    Equal<string?>(null, PluginAssetsEndpoints.ResolveAssetPath(pluginRoot, "missing.js"));
    return Task.CompletedTask;
}

static T Single<T>(IReadOnlyList<T> items)
{
    Equal(1, items.Count);
    return items[0];
}

static void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
        throw new InvalidOperationException($"Expected '{expected}', got '{actual}'.");
}

static void Throws<TException>(Action action) where TException : Exception
{
    try
    {
        action();
    }
    catch (TException)
    {
        return;
    }
    throw new InvalidOperationException($"Expected {typeof(TException).Name}.");
}

file static class FakeHttp
{
    public static HttpClient Create(Func<HttpRequestMessage, string> responder) => new(new Handler(responder))
    {
        Timeout = TimeSpan.FromSeconds(2),
    };

    private sealed class Handler(Func<HttpRequestMessage, string> responder) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(responder(request), Encoding.UTF8, "application/json"),
                RequestMessage = request,
            };
            return Task.FromResult(response);
        }
    }
}

file sealed class StubHttpClientFactory(HttpClient client) : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => client;
}

file sealed class StubProvider(
    string id,
    bool shouldFail = false,
    IReadOnlyList<SourceItem>? items = null) : IOnlineProvider
{
    public string Id => id;
    public string Name => id;
    public int SearchCalls { get; private set; }

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        SearchCalls++;
        if (shouldFail)
            throw new ProviderException($"{id} failed");

        IReadOnlyList<SourceItem> result = items ??
        [
            new SourceItem(id, id, $"{id}-source", query.Title ?? id, null, query.Year, null, "1080p", null, query.Type ?? "tv"),
        ];
        return Task.FromResult(result);
    }

    public Task<EpisodesResult> GetEpisodesAsync(SourceSelection source, CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken) =>
        throw new NotSupportedException();
}

file sealed class SearchConcurrencyTracker
{
    private int _current;
    private int _maximum;

    public int Maximum => _maximum;

    public void Enter()
    {
        var current = Interlocked.Increment(ref _current);
        var observed = _maximum;
        while (current > observed)
        {
            var replaced = Interlocked.CompareExchange(ref _maximum, current, observed);
            if (replaced == observed) break;
            observed = replaced;
        }
    }

    public void Exit() => Interlocked.Decrement(ref _current);
}

file sealed class ManualTimeProvider(DateTimeOffset now) : TimeProvider
{
    private DateTimeOffset _now = now;
    public override DateTimeOffset GetUtcNow() => _now;
    public void Advance(TimeSpan duration) => _now = _now.Add(duration);
}

file sealed class DelayedProvider(string id, SearchConcurrencyTracker tracker) : IOnlineProvider
{
    public string Id => id;
    public string Name => id;

    public async Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        tracker.Enter();
        try
        {
            await Task.Delay(25, cancellationToken);
            return [new SourceItem(id, id, id, query.Title ?? id, null, null, null, "720p", null, "tv")];
        }
        finally
        {
            tracker.Exit();
        }
    }

    public Task<EpisodesResult> GetEpisodesAsync(SourceSelection source, CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken) =>
        throw new NotSupportedException();
}

file sealed class CancellableProvider : IOnlineProvider
{
    public string Id => "cancellable";
    public string Name => "Cancellable";

    public async Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        return [];
    }

    public Task<EpisodesResult> GetEpisodesAsync(SourceSelection source, CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken) =>
        throw new NotSupportedException();
}

file sealed class PlaybackStubProvider : IOnlineProvider
{
    public string Id => "playback";
    public string Name => "Playback";
    public int ResolveCalls { get; private set; }

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<SourceItem>>([]);

    public Task<EpisodesResult> GetEpisodesAsync(SourceSelection source, CancellationToken cancellationToken) =>
        Task.FromResult(new EpisodesResult(
            [new EpisodeItem("episode", 1, 1, "Episode", "episode-locator", "Dub", [new AudioItem("audio", "Dub", "audio-locator")])],
            1));

    public Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken)
    {
        ResolveCalls++;
        if (selection.Locator != "audio-locator")
            throw new InvalidOperationException($"Expected 'audio-locator', got '{selection.Locator}'.");
        return Task.FromResult(new ResolvedPlayback("https://cdn.test/master.m3u8", "1080p", "Dub"));
    }
}
