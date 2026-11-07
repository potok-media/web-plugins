using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
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
    ("Filmix maps app search, post playback and the device flow", FilmixContract),
    ("AnimeON maps search, translations and direct episode streams", AnimeONContract),
    ("AnimeLib maps adult search, episodes and video-server streams", AnimeLibContract),
    ("Animevost parses the DLE search, page playlist and frame streams", AnimevostContract),
    ("LordFilm parses DLE search and the nextembed player config", LordFilmContract),
    ("AniDUB rotates dead CDN nodes and force-proxies sibnet streams", AniDubContract),
    ("KinoWatch device flow exposes the current activation domain", KinoWatchDeviceFlowContract),
    ("Alloha keeps account tokens request-scoped across search and playback", AllohaContract),
    ("Rezka uses the local account session for episodes and playback headers", RezkaContract),
    ("Provider search isolates failures and honors the requested source set", ProviderSearchContract),
    ("Provider search removes irrelevant title matches", ProviderSearchRelevanceContract),
    ("Provider search respects its concurrency bound", ProviderSearchConcurrencyContract),
    ("Provider search propagates request cancellation", ProviderSearchCancellationContract),
    ("Episode and playback services return direct URLs with provider headers", ApplicationServicesContract),
    ("Paid provider accounts are scoped and field-allowlisted", ProviderAccountContract),
    ("Service registration discovers all backend providers", ProviderDiscoveryContract),
    ("Provider failures log one structured error and rethrow", ProviderLoggingContract),
    ("A stuck provider times out on its own budget and never blocks the search", ProviderTimeoutContract),
    ("Streaming search emits provider chunks in completion order before the final response", ProviderStreamingContract),
    ("An unexpected provider exception lands in errors without failing the batch", ProviderCatchAllContract),
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

static async Task FilmixContract()
{
    var http = FakeHttp.Create(request => request.RequestUri!.AbsolutePath switch
    {
        "/api/v2/search" => """
            [{"id":55,"title":"Тест","original_title":"Original","poster":"https://img.test/p.jpg","year":2025}]
            """,
        "/api/v2/post/55" => """
            {"player_links":{"movie":[{"link":"https://s.test/s/hash55/dir/movie_[[1080,720]].mp4","translation":"Дубляж"}]}}
            """,
        "/api/v2/post/56" => """
            {"player_links":{"playlist":{"1":{"Дубляж":{"1":{"link":"https://s.test/s/hash56/dir/ep_%s.mp4","qualities":[720,480]}}}}}}
            """,
        _ => throw new InvalidOperationException(request.RequestUri.ToString()),
    });
    using var cache = new MemoryCache(new MemoryCacheOptions());
    var provider = new FilmixProvider(http, cache);
    var context = ProviderRequestContext.For(provider, new ProviderAccount("filmix",
        new Dictionary<string, string> { ["accessToken"] = "filmix-token" }));
    var query = new MediaQuery("movie", "Тест", "Original", null, 2025, null, null);

    var sources = await provider.SearchAsync(query, context, default);
    var source = Single(sources);
    Equal("55", source.SourceId);
    Equal("Тест / Original", source.Title);
    Equal(2025, source.Year);

    // Movie: one pseudo-episode, per-translation audios, mp4 link expanded to the best
    // quality and rewritten to the Filmix HLS endpoint.
    var movie = await provider.GetEpisodesAsync(new SourceSelection("55", query), context, default);
    var movieEpisode = Single(movie.Episodes);
    Equal("Фильм", movieEpisode.Title);
    var playback = await provider.ResolveAsync(
        new PlaybackSelection("55", query, null, null, movieEpisode.Audios[0].Name, movieEpisode.Audios[0].Locator),
        context,
        default);
    Equal("https://s.test/hls/dir/movie_1080.mp4/index.m3u8?hash=hash55", playback.Url);
    Equal("1080p", playback.Quality);
    Equal("Дубляж", playback.Voice);

    // Series: season/voice playlist parsed from the post payload.
    var series = await provider.GetEpisodesAsync(new SourceSelection("56", new MediaQuery("tv", "Тест", null, null, null, null, null)), context, default);
    var episode = Single(series.Episodes);
    Equal(1, episode.Season);
    Equal(1, episode.Number);
    Equal("Дубляж", episode.Audios[0].Name);
    var seriesPlayback = await provider.ResolveAsync(
        new PlaybackSelection("56", query, 1, 1, "Дубляж", episode.Audios[0].Locator),
        context,
        default);
    Equal("https://s.test/hls/dir/ep_720.mp4/index.m3u8?hash=hash56", seriesPlayback.Url);
    Equal("720p", seriesPlayback.Quality);
}

static async Task FilmixDeviceFlowContract()
{
    var http = FakeHttp.Create(request =>
    {
        if (request.RequestUri!.AbsolutePath != "/api/v2/token_request")
            throw new InvalidOperationException(request.RequestUri.ToString());
        return """
            {"code":"filmix-device-code","user_code":"ABCD-EFGH"}
            """;
    });
    var accounts = new AccountConnectionService(new StubHttpClientFactory(http));

    var device = await accounts.StartFilmixAsync(default);
    Equal("filmix-device-code", device.Code);
    Equal("ABCD-EFGH", device.UserCode);
    Equal("https://filmix.my/consoles", device.VerificationUri);

    var connected = await accounts.PollFilmixAsync(new KinoPubDevicePollRequest("filmix-device-code"), default);
    Equal("filmix", connected.Account.Provider);
    Equal("filmix-device-code", connected.Account.Values["accessToken"]);
}

static async Task AnimeONContract()
{
    var http = FakeHttp.Create(request => request.RequestUri!.AbsolutePath switch
    {
        "/api/anime/search" => """
            {"result":[{"id":"7","season":"1","imdbId":"tt1","titleUa":"Тайтл","releaseDate":"2024","image":{"preview":"p.jpg"}}]}
            """,
        "/api/player/7/translations" => """
            {"translations":[{"translation":{"id":3,"name":"Ashdi"},"player":[{"name":"Ashdi","id":9}]}]}
            """,
        "/api/player/7/episodes" => """
            {"episodes":[{"episode":"1","title":"1 серия","fileUrl":"https://cdn.test/e1.mp4"}]}
            """,
        _ => throw new InvalidOperationException(request.RequestUri.ToString()),
    });
    using var cache = new MemoryCache(new MemoryCacheOptions());
    var provider = new AnimeONProvider(http, cache);
    var query = new MediaQuery("tv", "Тайтл", null, null, 2024, null, null);

    var source = Single(await provider.SearchAsync(query, default));
    Equal("7:1", source.SourceId);
    Equal("Тайтл", source.Title);
    Equal("https://animeon.club/api/uploads/images/p.jpg", source.Poster);

    var episodes = await provider.GetEpisodesAsync(new SourceSelection(source.SourceId, query), default);
    var episode = Single(episodes.Episodes);
    Equal(1, episode.Number);
    Equal("Ashdi", episode.Audios[0].Name);

    var playback = await provider.ResolveAsync(
        new PlaybackSelection(source.SourceId, query, 1, 1, "Ashdi", episode.Audios[0].Locator), default);
    Equal("https://cdn.test/e1.mp4", playback.Url);
    Equal("auto", playback.Quality);
}

static async Task AnimeLibContract()
{
    var searchHeaders = (string?)null;
    var http = FakeHttp.Create(request =>
    {
        if (request.RequestUri!.AbsolutePath == "/api/anime")
        {
            searchHeaders = request.Headers.TryGetValues("site-id", out var siteId) ? string.Join(",", siteId) : null;
            if (request.Headers.TryGetValues("Origin", out var origin))
                searchHeaders += $"|{string.Join(",", origin)}";
        }
        return request.RequestUri.AbsolutePath switch
    {
        "/api/anime" => """
            {"data":[{"slug_url":"slug-x","rus_name":"Рус","eng_name":"Eng","releaseDate":"2024-05-01","cover":{"default":"https://img.test/c.jpg"}}]}
            """,
        "/api/episodes" => """
            {"data":[{"id":11,"name":"","number":"1","season":"1"}]}
            """,
        "/api/episodes/11" => """
            {"data":{"players":[{"player":"Animelib","team":{"name":"AniLib"},"video_domain":"main","video":{"quality":[{"href":"a/1080.mp4","quality":1080}]}}]}}
            """,
        "/api/constants" => """
            {"data":{"videoServers":[{"id":"main","url":"https://vs.test/"}]}}
            """,
        _ => throw new InvalidOperationException(request.RequestUri.ToString()),
    };
    });
    using var cache = new MemoryCache(new MemoryCacheOptions());
    var provider = new AnimeLibProvider(http, cache);
    Equal(true, provider.Descriptor.Adult);

    var source = Single(await provider.SearchAsync(new MediaQuery("tv", "Рус", "Eng", null, null, null, null), default));
    Equal("slug-x", source.SourceId);
    // The API 403s bare requests — the app headers ride along.
    Equal("5|https://anilib.me", searchHeaders);
    Equal("Рус / Eng", source.Title);
    Equal(2024, source.Year);

    var episodes = await provider.GetEpisodesAsync(new SourceSelection(source.SourceId, new MediaQuery("tv", "Рус", null, null, null, null, null)), default);
    var episode = Single(episodes.Episodes);
    Equal("AniLib", episode.Audios[0].Name);

    var playback = await provider.ResolveAsync(
        new PlaybackSelection(source.SourceId, new MediaQuery("tv", "Рус", null, null, null, null, null), 1, 1, "AniLib", episode.Audios[0].Locator),
        default);
    Equal("https://vs.test/a/1080.mp4", playback.Url);
    Equal("1080p", playback.Quality);
    Equal("AniLib", playback.Voice);
}

static async Task AnimevostContract()
{
    var http = FakeHttp.Create(request => (request.Method.Method, request.RequestUri!.AbsolutePath) switch
    {
        ("POST", "/index.php") => """
            <div class="shortstory">
              <a href="https://animevost.org/123-test-2-season.html">Тайтл 2nd Season</a>
              <strong>Год выхода: </strong>2020</p>
              <img src="/uploads/posts/1.jpg">
            </div>
            <div class="shortstory">
              <a href="https://animevost.org/124-other.html">Другой тайтл</a>
              <strong>Год выхода: </strong>2019</p>
            </div>
            """,
        ("GET", "/123-test-2-season.html") => """
            <html><script>var data = {"1 серия":"1001","2 серия":"1002",};</script></html>
            """,
        ("GET", "/frame5.php") => """
            <a download="invoice" href="https://s1.test/v/720.mp4">720p</a>
            <a download="invoice" href="https://s1.test/v/480.mp4">480p</a>
            """,
        _ => throw new InvalidOperationException(request.RequestUri.ToString()),
    });
    using var cache = new MemoryCache(new MemoryCacheOptions());
    var provider = new AnimevostProvider(http, cache);
    var query = new MediaQuery("tv", "Тайтл", null, null, null, null, null);

    var sources = await provider.SearchAsync(query, default);
    Equal(2, sources.Count);
    var source = sources[0];
    Equal("2|https://animevost.org/123-test-2-season.html", source.SourceId);
    Equal("Тайтл 2nd Season", source.Title);
    Equal(2020, source.Year);
    Equal("https://animevost.org/uploads/posts/1.jpg", source.Poster);

    var episodes = await provider.GetEpisodesAsync(new SourceSelection(source.SourceId, query), default);
    Equal(2, episodes.Episodes.Count);
    Equal(2, episodes.Episodes[1].Number);

    var playback = await provider.ResolveAsync(
        new PlaybackSelection(source.SourceId, query, 2, 1, null, episodes.Episodes[0].Audios.Count == 0
            ? episodes.Episodes[0].Locator
            : episodes.Episodes[0].Locator),
        default);
    Equal("https://s1.test/v/720.mp4", playback.Url);
    Equal("720p", playback.Quality);
}

static async Task LordFilmContract()
{
    var http = FakeHttp.Create(request => (request.Method.Method, request.RequestUri!.Host, request.RequestUri!.AbsolutePath) switch
    {
        ("POST", "gv.lordfilm5.pro", "/search-result/") => """
            <div class="th-item">
              <a class="th-in with-mask" href="https://gv.lordfilm5.pro/55-film.html"></a>
              <div class="th-title">Тестовый фильм</div>
              <div class="th-series">2025, фильм</div>
              <img src="https://img.test/lf.jpg">
            </div>
            """,
        ("GET", "gv.lordfilm5.pro", "/55-film.html") => """
            <iframe src="https://api.nextembed.ws/embed/movie/777"></iframe>
            """,
        ("GET", "api.nextembed.ws", "/embed/movie/777") => """
            <script> var player = { source: { hls: "https://cdn.interkh.com/m/master.m3u8", dasha: "https://cdn.interkh.com/m/master.mpd", title: "x" }, }; </script>
            """,
        _ => throw new InvalidOperationException(request.RequestUri.ToString()),
    });
    using var cache = new MemoryCache(new MemoryCacheOptions());
    var provider = new LordFilmProvider(http, cache);
    var query = new MediaQuery("movie", "Тестовый фильм", null, null, 2025, null, null);

    var source = Single(await provider.SearchAsync(query, default));
    Equal("https://gv.lordfilm5.pro/55-film.html", source.SourceId);
    Equal("Тестовый фильм", source.Title);
    Equal(2025, source.Year);

    var episodes = await provider.GetEpisodesAsync(new SourceSelection(source.SourceId, query), default);
    var episode = Single(episodes.Episodes);
    Equal("Фильм", episode.Title);

    var playback = await provider.ResolveAsync(
        new PlaybackSelection(source.SourceId, query, null, null, null, episode.Audios[0].Locator), default);
    // DASH (1080p) предпочитается HLS; Referer nextembed уходит в заголовки.
    Equal("https://cdn.interkh.com/m/master.mpd", playback.Url);
    Equal("1080p", playback.Quality);
    Equal("https://api.nextembed.ws/", playback.Headers?["Referer"]);
}

static async Task AniDubContract()
{
    var bodies = new Queue<string>(new[]
    {
        // 1st master: bad node (hard-banned) — must be skipped.
        "https://cdn1.anivids.link/hls/s1/fhd.mp4/index.m3u8\n",
        // 2nd master: dead node (probe fails) — must be marked and skipped.
        "https://cdn2.anivids.link/hls/s1/fhd.mp4/index.m3u8\n",
        // 3rd master: live node (probe returns the manifest).
        "https://cdn3.anivids.link/hls/s1/fhd.mp4/index.m3u8\n",
    });
    var requests = new List<string>();
    var http = FakeHttp.Create(request =>
    {
        requests.Add(request.RequestUri!.AbsoluteUri);
        var path = request.RequestUri.AbsolutePath;
        if (path == "/index.php")
        {
            return request.Method.Method == "POST"
                ? """
                <a class="th-in" href="https://online.anidub.com/200-title-tv-2.html"><div class="th-title">Тайтл ТВ-2</div></a>
                """
                : throw new InvalidOperationException(request.RequestUri.ToString());
        }
        if (path == "/200-title-tv-2.html")
            return """
                <iframe src="https://player.ladonyvesna2005.info/index.php?v=/s2/abcdef0123"></iframe>
                """;
        if (path == "/index.php" || (path.Contains("vid.php") && bodies.Count > 0))
            return bodies.Count > 0 ? bodies.Dequeue() : string.Empty;
        if (request.RequestUri.Host.Contains("cdn2.anivids.link"))
            return "403"; // dead node probe: not a manifest
        if (request.RequestUri.Host.Contains("cdn3.anivids.link"))
            return "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchunk.m3u8";
        if (path == "/shell.php")
            return """
                <html><head><meta property="og:title" content="[AniDub]_Title_[01]_[720p_x264]"/></head>
                <body><script>player.src([{src: "/v/aa/11.mp4", type: "video/mp4"}]);</script></body></html>
                """;
        if (path == "/v/aa/11.mp4")
            return "binary"; // ranged request; FakeHttp keeps the request URI (no redirect)
        throw new InvalidOperationException(request.RequestUri.ToString());
    });
    using var cache = new MemoryCache(new MemoryCacheOptions());
    var provider = new AniDubProvider(http, cache);
    var query = new MediaQuery("tv", "Тайтл", null, null, null, null, null);

    var source = Single(await provider.SearchAsync(query, default));
    Equal("2|https://online.anidub.com/200-title-tv-2.html", source.SourceId);

    var episodes = await provider.GetEpisodesAsync(new SourceSelection(source.SourceId, query), default);
    var episode = Single(episodes.Episodes);
    Equal(2, episode.Season);

    // Player path: cdn1 hard-banned, cdn2 probed dead, cdn3 alive → rotation observed.
    var playback = await provider.ResolveAsync(
        new PlaybackSelection(source.SourceId, query, 2, 1, "AniDUB", episode.Audios[0].Locator), default);
    Equal("https://cdn3.anivids.link/hls/s1/fhd.mp4/index.m3u8", playback.Url);
    Equal("1080p", playback.Quality);
    Contains("cdn2.anivids.link", string.Join("\n", requests)); // dead node probed and skipped
    Contains("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", playback.Headers?["User-Agent"]);

    // Sibnet path: shell → file → server-side resolve; Referer/Origin force the proxied path.
    var sibEpisodesPage = "<span data=\"https://video.sibnet.ru/shell.php?videoid=3460549\">Серия 1</span>";
    var sibHttp = FakeHttp.Create(request => request.RequestUri!.AbsolutePath switch
    {
        "/page.html" => sibEpisodesPage,
        "/shell.php" => """
            <html><head><meta property="og:title" content="[AniDub]_Title_[01]_[720p_x264]"/></head>
            <body><script>player.src([{src: "/v/aa/11.mp4", type: "video/mp4"}]);</script></body></html>
            """,
        "/v/aa/11.mp4" => "binary",
        _ => throw new InvalidOperationException(request.RequestUri.ToString()),
    });
    var sibProvider = new AniDubProvider(sibHttp, new MemoryCache(new MemoryCacheOptions()));
    var sibEpisodes = await sibProvider.GetEpisodesAsync(
        new SourceSelection("1|https://online.anidub.com/page.html", query), default);
    var sibEpisode = Single(sibEpisodes.Episodes);
    var sibPlayback = await sibProvider.ResolveAsync(
        new PlaybackSelection("1|https://online.anidub.com/page.html", query, 1, 1, "AniDUB", sibEpisode.Audios[0].Locator), default);
    Equal("https://video.sibnet.ru/v/aa/11.mp4", sibPlayback.Url);
    Equal("720p", sibPlayback.Quality);
    Equal("https://video.sibnet.ru/", sibPlayback.Headers?["Referer"]);
    Equal("https://video.sibnet.ru", sibPlayback.Headers?["Origin"]);
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
    var episodeService = new EpisodeService(registry);
    var playbackService = new PlaybackService(registry);
    var query = new MediaQuery("tv", "Anime", null, null, 2024, 42, null);

    var result = await episodeService.GetEpisodesAsync(
        new EpisodesRequest(provider.Id, "source", query),
        "https://plugin.test",
        default);
    var episode = Single(result.Episodes);
    Equal(null, episode.Url);
    Equal(null, Single(episode.Audios).Url);

    var playback = await playbackService.ResolveAsync(
        new PlaybackRequest(provider.Id, "source", query, 1, 1, null, "episode-locator"),
        "https://plugin.test",
        default);
    Equal("https://cdn.test/master.m3u8", playback.StreamUrl);
    Equal("m3u8", playback.StreamType);
    Equal("Dub", playback.Voice);
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

    Equal("alloha,anidub,aniliberty,animego,animelib,animeon,animevost,filmix,kinopub,kodik,lordfilm,rezka,veoveo,videohub", string.Join(',', ids));
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

static async Task ProviderLoggingContract()
{
    var logger = new CapturingLogger();
    var provider = new LoggingOnlineProvider(new FailingProvider(), "kodik", logger);
    var query = new MediaQuery("tv", "Чёрный клевер", "ブラッククローバー", null, 2017, 73223, null);

    var thrown = false;
    try
    {
        await provider.ResolveAsync(
            new PlaybackSelection("serial-4898", query, 1, 1, "AniLibria.TV", null),
            CancellationToken.None);
    }
    catch (InvalidOperationException)
    {
        thrown = true;
    }
    Equal(true, thrown);

    Equal(1, logger.Entries.Count);
    var (level, message) = logger.Entries[0];
    Equal(LogLevel.Error, level);
    Contains("PROVIDER FAILED", message);
    Contains("provider:    kodik", message);
    Contains("operation:   ResolveAsync (playback)", message);
    Contains("sourceId: serial-4898", message);
    Contains("season/episode/voice: 1/1/AniLibria.TV", message);
    Contains("Чёрный клевер / ブラッククローバー", message);
    Contains("tmdb:73223", message);
    Contains("error:       InvalidOperationException: resolve exploded", message);
    // The full exception text pins the failure site.
    Contains("stack:", message);
    Contains("FailingProvider", message);

    // Successful operations stay silent.
    await provider.SearchAsync(query, CancellationToken.None);
    Equal(1, logger.Entries.Count);
}

static void Contains(string expected, string actual)
{
    if (!actual.Contains(expected, StringComparison.Ordinal))
        throw new InvalidOperationException($"Expected '{actual}' to contain '{expected}'.");
}

static async Task ProviderTimeoutContract()
{
    var coordinator = new ProviderSearchCoordinator(
        new ProviderRegistry([new StubProvider("good"), new StuckProvider("stuck")]),
        maxConcurrency: 2,
        perProviderTimeout: TimeSpan.FromMilliseconds(300));

    var started = DateTimeOffset.UtcNow;
    var response = await coordinator.SearchAsync(
        new MediaQuery("tv", "Anime", null, null, null, null, null),
        null,
        CancellationToken.None);
    var elapsed = DateTimeOffset.UtcNow - started;

    Equal(1, response.Items.Count);
    Equal("good", response.Items[0].Provider);
    // The stuck provider lands in errors as a soft timeout (the UI can retry it) and the
    // whole search finishes on the budget, not on the stuck provider's own stall.
    Equal(true, response.Errors.TryGetValue("stuck", out var message));
    Equal(true, message.Contains("timed out", StringComparison.Ordinal));
    Equal(true, elapsed < TimeSpan.FromSeconds(5));
}


static async Task ProviderStreamingContract()
{
    var chunks = new List<ProviderSearchChunk>();
    var coordinator = new ProviderSearchCoordinator(
        new ProviderRegistry([new StubProvider("good"), new StuckProvider("stuck")]),
        maxConcurrency: 2,
        perProviderTimeout: TimeSpan.FromMilliseconds(300));

    var final = await coordinator.SearchStreamingAsync(
        new MediaQuery("tv", "Anime", null, null, null, null, null),
        providerIds: null,
        accounts: null,
        onChunk: (chunk, ct) =>
        {
            lock (chunks) chunks.Add(chunk);
            return ValueTask.CompletedTask;
        },
        cancellationToken: CancellationToken.None);

    // Chunks arrive in completion order: the fast provider first, the stuck one's soft
    // error when its budget expires.
    Equal(2, chunks.Count);
    Equal("provider", chunks[0].Type);
    Equal("good", chunks[0].Provider);
    Equal(1, chunks[0].Items?.Count);
    Equal("provider-error", chunks[1].Type);
    Equal("stuck", chunks[1].Provider);
    Equal(true, chunks[1].Error!.Contains("timed out", StringComparison.Ordinal));

    // The NDJSON line shape the endpoint serializes.
    var line = JsonSerializer.Serialize(chunks[0], new JsonSerializerOptions(JsonSerializerDefaults.Web));
    Equal(true, line.Contains("\"type\":\"provider\"", StringComparison.Ordinal));
    Equal(true, line.Contains("\"provider\":\"good\"", StringComparison.Ordinal));

    Equal(1, final.Items.Count);
    Equal(true, final.Errors.ContainsKey("stuck"));
}

static async Task ProviderCatchAllContract()
{
    var coordinator = new ProviderSearchCoordinator(
        new ProviderRegistry([new StubProvider("good"), new ExplodingProvider("boom")]),
        maxConcurrency: 2);

    var response = await coordinator.SearchAsync(
        new MediaQuery("tv", "Anime", null, null, null, null, null),
        providerIds: null,
        account: null,
        cancellationToken: CancellationToken.None);

    // The unexpected InvalidOperationException is caught per provider: the batch result
    // and the (NDJSON) stream survive, the offender lands in errors.
    Equal(1, response.Items.Count);
    Equal("good", response.Items[0].Provider);
    Equal(true, response.Errors.TryGetValue("boom", out var message));
    Equal(true, message.Contains("kaboom", StringComparison.Ordinal));
}

file sealed class FailingProvider : IOnlineProvider
{
    public string Id => "kodik";
    public string Name => "Kodik";

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<SourceItem>>([]);

    public Task<EpisodesResult> GetEpisodesAsync(SourceSelection source, CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken) =>
        throw new InvalidOperationException("resolve exploded");
}

file sealed class CapturingLogger : ILogger<LoggingOnlineProvider>
{
    public List<(LogLevel Level, string Message)> Entries { get; } = [];

    IDisposable? ILogger.BeginScope<TState>(TState state) => null;
    public bool IsEnabled(LogLevel logLevel) => true;
    public void Log<TState>(
        LogLevel logLevel, EventId eventId, TState state, Exception? exception,
        Func<TState, Exception?, string> formatter) =>
        Entries.Add((logLevel, formatter(state, exception)));
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

file sealed class StuckProvider(string id) : IOnlineProvider
{
    public string Id => id;
    public string Name => id;

    public async Task<IReadOnlyList<SourceItem>> SearchAsync(
        MediaQuery query, ProviderRequestContext context, CancellationToken cancellationToken)
    {
        await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        return [];
    }

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken) =>
        SearchAsync(query, ProviderRequestContext.Empty, cancellationToken);

    public Task<EpisodesResult> GetEpisodesAsync(SourceSelection source, CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken) =>
        throw new NotSupportedException();
}

file sealed class ExplodingProvider(string id) : IOnlineProvider
{
    public string Id => id;
    public string Name => id;

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, ProviderRequestContext context, CancellationToken cancellationToken) =>
        throw new InvalidOperationException("kaboom");

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken) =>
        throw new InvalidOperationException("kaboom");

    public Task<EpisodesResult> GetEpisodesAsync(SourceSelection source, CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken) =>
        throw new NotSupportedException();
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
            [new EpisodeItem("episode", 1, 1, "Episode", "Dub", null, [new AudioItem("audio", "Dub", "audio-locator")], "episode-locator")],
            1));

    public Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken)
    {
        ResolveCalls++;
        return Task.FromResult(new ResolvedPlayback("https://cdn.test/master.m3u8", "1080p", "Dub"));
    }
}
