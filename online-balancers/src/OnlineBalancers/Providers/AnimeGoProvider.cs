using Microsoft.Extensions.Caching.Memory;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace OnlineBalancers.Providers;

public sealed partial class AnimeGoProvider(HttpClient http, IMemoryCache? cache = null) : ProviderBase(http, cache), IOnlineProvider
{
    private const string Host = "https://animego.me";
    private readonly KodikPlayerResolver _kodikPlayer = new(http);

    public string Id => "animego";
    public string Name => "AnimeGo";

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        var title = query.Title ?? query.OriginalTitle;
        if (string.IsNullOrWhiteSpace(title))
            return Task.FromResult<IReadOnlyList<SourceItem>>([]);

        return CachedAsync<IReadOnlyList<SourceItem>>(
            $"animego:search:{title}",
            TimeSpan.FromHours(4),
            async () =>
            {
                var html = await GetStringAsync(Get($"{Host}/search/anime?q={Uri.EscapeDataString(title)}"), cancellationToken);
                var current = ParseCurrentSearch(html, title);
                return current.Count > 0 ? current : ParseLegacySearch(html, title);
            });
    }

    public async Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken)
    {
        var playlist = await GetPlaylistAsync(selection.SourceId, cancellationToken);
        if (playlist.Mode == PlaylistMode.Current)
        {
            var currentEpisodes = playlist.Episodes.Select(episode => new EpisodeItem(
                Id: $"{Id}:{selection.SourceId}:{episode.Number:g}",
                Season: 1,
                Number: episode.Number,
                Title: $"{episode.Number:g} серия",
                Voice: null,
                Url: null,
                Audios: [],
                Locator: LocatorCodec.Encode(new AnimeGoLocator("current", episode.InternalId, null, null, null)))).ToArray();
            return new EpisodesResult(currentEpisodes, 1);
        }

        var audios = playlist.Translations.Select(item => new AudioItem(
            item.Id,
            item.Name,
            LocatorCodec.Encode(new AnimeGoLocator("legacy", null, playlist.EmbedHost, playlist.Token, item.Id)))).ToArray();
        var defaultVoice = playlist.Translations.FirstOrDefault(item => item.Id == playlist.DefaultTranslation)?.Name;
        var legacyEpisodes = playlist.Episodes.Select(episode => new EpisodeItem(
            Id: $"{Id}:{selection.SourceId}:{episode.Number:g}",
            Season: 1,
            Number: episode.Number,
            Title: $"{episode.Number:g} серия",
            Voice: defaultVoice,
            Url: null,
            Audios: audios,
            Locator: LocatorCodec.Encode(new AnimeGoLocator("legacy", null, playlist.EmbedHost, playlist.Token, playlist.DefaultTranslation)))).ToArray();
        return new EpisodesResult(legacyEpisodes, 1);
    }

    public async Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken)
    {
        if (!selection.Episode.HasValue)
            throw new ProviderException("AnimeGo episode is missing.");

        var playlist = await GetPlaylistAsync(selection.SourceId, cancellationToken);
        AnimeGoLocator? locator = null;
        if (!string.IsNullOrWhiteSpace(selection.Locator))
            locator = LocatorCodec.Decode<AnimeGoLocator>(selection.Locator);

        if (playlist.Mode == PlaylistMode.Current || locator?.Mode == "current")
            return await ResolveCurrentAsync(selection, playlist, locator, cancellationToken);
        return await ResolveLegacyAsync(selection, playlist, locator, cancellationToken);
    }

    private async Task<ResolvedPlayback> ResolveCurrentAsync(
        PlaybackSelection selection,
        Playlist playlist,
        AnimeGoLocator? locator,
        CancellationToken cancellationToken)
    {
        var episode = playlist.Episodes.FirstOrDefault(item =>
            item.InternalId == locator?.EpisodeId || Math.Abs(item.Number - selection.Episode!.Value) < 0.0001)
            ?? throw new ProviderException("AnimeGo episode was not found.");
        if (string.IsNullOrWhiteSpace(episode.InternalId))
            throw new ProviderException("AnimeGo episode id is missing.");

        var json = await GetCurrentJsonAsync($"{Host}/player/videos/{episode.InternalId}", cancellationToken);
        var content = ExtractContent(json);
        var players = ParseCurrentPlayers(content);
        if (players.Count == 0)
            throw new ProviderException("AnimeGo did not return a supported player.");
        var selected = !string.IsNullOrWhiteSpace(selection.Voice)
            ? players.FirstOrDefault(item => string.Equals(item.Voice, selection.Voice, StringComparison.OrdinalIgnoreCase))
            : null;
        selected ??= players.FirstOrDefault(item => item.Provider == "aniboom") ?? players[0];

        if (selected.Provider == "kodik")
        {
            var streams = await _kodikPlayer.ResolveAsync(selected.Url, $"{Host}/", cancellationToken);
            var best = streams.OrderByDescending(item => item.Height).FirstOrDefault()
                ?? throw new ProviderException("AnimeGo/Kodik did not return a playable stream.");
            return new ResolvedPlayback(
                best.Url,
                $"{best.Height}p",
                selected.Voice,
                new Dictionary<string, string> { ["Referer"] = $"{Host}/" });
        }

        return await ResolveAniBoomUrlAsync(selected.Url, selected.Voice, cancellationToken);
    }

    private async Task<ResolvedPlayback> ResolveLegacyAsync(
        PlaybackSelection selection,
        Playlist playlist,
        AnimeGoLocator? locator,
        CancellationToken cancellationToken)
    {
        var selectedTranslation = !string.IsNullOrWhiteSpace(selection.Voice)
            ? playlist.Translations.FirstOrDefault(item => string.Equals(item.Name, selection.Voice, StringComparison.OrdinalIgnoreCase))
            : null;
        var translationId = selectedTranslation?.Id ?? locator?.TranslationId ?? playlist.DefaultTranslation;
        var voice = selectedTranslation?.Name
            ?? playlist.Translations.FirstOrDefault(item => item.Id == translationId)?.Name;
        var embedHost = locator?.EmbedHost ?? playlist.EmbedHost;
        var token = locator?.Token ?? playlist.Token;
        if (string.IsNullOrWhiteSpace(embedHost) ||
            string.IsNullOrWhiteSpace(token) ||
            string.IsNullOrWhiteSpace(translationId) ||
            !IsAniBoomHost(embedHost) ||
            !SafeTokenRegex().IsMatch(token) ||
            !SafeTokenRegex().IsMatch(translationId))
            throw new ProviderException("AnimeGo playback locator is invalid.");

        var number = selection.Episode!.Value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
        var playerUrl = $"https://{embedHost}/embed/{Uri.EscapeDataString(token)}?episode={Uri.EscapeDataString(number)}&translation={Uri.EscapeDataString(translationId)}";
        return await ResolveAniBoomUrlAsync(playerUrl, voice, cancellationToken);
    }

    private async Task<ResolvedPlayback> ResolveAniBoomUrlAsync(string playerUrl, string? voice, CancellationToken cancellationToken)
    {
        var absolute = ProviderParsing.AbsoluteHttps(WebUtility.HtmlDecode(playerUrl));
        if (!Uri.TryCreate(absolute, UriKind.Absolute, out var uri) || !IsAniBoomHost(uri.Host))
            throw new ProviderException("AnimeGo returned an unexpected player host.");
        var request = Get(uri.ToString(), $"{Host}/");
        AddAjaxHeaders(request);
        var embed = await GetStringAsync(request, cancellationToken);
        embed = WebUtility.HtmlDecode(embed).Replace("\\", string.Empty, StringComparison.Ordinal);
        var match = HlsRegex().Match(embed);
        if (!match.Success)
            throw new ProviderException("AnimeGo did not return an HLS stream.");
        var streamUrl = ProviderParsing.AbsoluteHttps(match.Groups[1].Value);
        return new ResolvedPlayback(
            streamUrl,
            "1080p",
            voice,
            new Dictionary<string, string>
            {
                ["Origin"] = $"{uri.Scheme}://{uri.Authority}",
                ["Referer"] = $"{uri.Scheme}://{uri.Authority}/",
            });
    }

    private Task<Playlist> GetPlaylistAsync(string sourceId, CancellationToken cancellationToken)
    {
        if (!int.TryParse(sourceId, out _))
            throw new ProviderException("AnimeGo source id is invalid.");

        return CachedAsync(
            $"animego:playlist:{sourceId}",
            TimeSpan.FromMinutes(30),
            async () =>
            {
                try
                {
                    return await GetCurrentPlaylistAsync(sourceId, cancellationToken);
                }
                catch (Exception exception) when (exception is HttpRequestException or JsonException or ProviderException)
                {
                    return await GetLegacyPlaylistAsync(sourceId, cancellationToken);
                }
            });
    }

    private async Task<Playlist> GetCurrentPlaylistAsync(string sourceId, CancellationToken cancellationToken)
    {
        var json = await GetCurrentJsonAsync($"{Host}/player/{sourceId}", cancellationToken);
        var content = WebUtility.HtmlDecode(ExtractContent(json));
        var episodes = ParseCurrentEpisodes(content).ToList();
        var total = ParseInt(TotalEpisodesRegex().Match(content).Groups[1].Value, episodes.Count);
        var pageSize = Math.Max(1, ParseInt(PageSizeRegex().Match(content).Groups[1].Value, 100));
        var pageCount = (int)Math.Ceiling(total / (double)pageSize);
        if (pageCount > 100)
            throw new ProviderException("AnimeGo returned too many episode pages.");

        if (pageCount > 1)
        {
            var pageTasks = Enumerable.Range(1, pageCount - 1).Select(async page =>
            {
                var pageJson = await GetCurrentJsonAsync($"{Host}/player/{sourceId}/episodes?page={page}", cancellationToken);
                return ParseCurrentEpisodes(WebUtility.HtmlDecode(ExtractContent(pageJson)));
            });
            foreach (var page in await Task.WhenAll(pageTasks))
                episodes.AddRange(page);
        }

        var distinct = episodes
            .Where(item => !string.IsNullOrWhiteSpace(item.InternalId))
            .GroupBy(item => item.InternalId, StringComparer.Ordinal)
            .Select(group => group.First())
            .OrderBy(item => item.Number)
            .ToArray();
        if (distinct.Length == 0)
            throw new ProviderException("AnimeGo did not return episodes.");
        return new Playlist(PlaylistMode.Current, null, null, null, distinct, []);
    }

    private async Task<Playlist> GetLegacyPlaylistAsync(string sourceId, CancellationToken cancellationToken)
    {
        var request = Get($"{Host}/anime/{sourceId}/player?_allow=true", $"{Host}/");
        AddAjaxHeaders(request);
        var json = await GetStringAsync(request, cancellationToken);
        using var document = JsonDocument.Parse(json);
        if (!document.RootElement.TryGetProperty("content", out var contentProperty))
            throw new ProviderException("AnimeGo player response has no content.");
        var content = contentProperty.GetString();
        if (string.IsNullOrWhiteSpace(content))
            throw new ProviderException("AnimeGo player response is empty.");

        var player = LegacyPlayerRegex().Match(content);
        if (!player.Success)
            throw new ProviderException("AnimeGo player was not found.");
        var embedHost = player.Groups[1].Value;
        var token = player.Groups[2].Value;
        var defaultTranslation = player.Groups[3].Value;
        if (!IsAniBoomHost(embedHost))
            throw new ProviderException("AnimeGo returned an unexpected player host.");

        var episodes = LegacyEpisodeRegex().Matches(content)
            .Select((match, index) => new AnimeGoEpisode(ProviderParsing.EpisodeNumber(match.Groups[1].Value, index + 1), null))
            .DistinctBy(item => item.Number)
            .ToArray();
        if (episodes.Length == 0)
            throw new ProviderException("AnimeGo did not return episodes.");

        var translations = new List<Translation>();
        foreach (Match match in LegacyTranslationRegex().Matches(content))
        {
            var translationId = match.Groups[1].Value;
            var dubbingId = match.Groups[2].Value;
            var nameMatch = Regex.Match(
                content,
                $"data-dubbing=\"{Regex.Escape(dubbingId)}\"[^>]*>.*?<span[^>]*>\\s*([^<\\r\\n]+)",
                RegexOptions.IgnoreCase | RegexOptions.Singleline);
            var name = WebUtility.HtmlDecode(nameMatch.Groups[1].Value).Trim();
            if (!string.IsNullOrWhiteSpace(name) && translations.All(item => item.Id != translationId))
                translations.Add(new Translation(translationId, name));
        }
        if (translations.All(item => item.Id != defaultTranslation))
            translations.Insert(0, new Translation(defaultTranslation, "Основной перевод"));
        return new Playlist(PlaylistMode.Legacy, embedHost, token, defaultTranslation, episodes, translations);
    }

    private async Task<string> GetCurrentJsonAsync(string url, CancellationToken cancellationToken)
    {
        var request = Get(url, $"{Host}/");
        AddAjaxHeaders(request);
        return await GetStringAsync(request, cancellationToken);
    }

    private static string ExtractContent(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.TryGetProperty("data", out var data) && data.TryGetProperty("content", out var nested))
            return nested.GetString() ?? throw new ProviderException("AnimeGo player content is empty.");
        if (root.TryGetProperty("content", out var direct))
            return direct.GetString() ?? throw new ProviderException("AnimeGo player content is empty.");
        throw new ProviderException("AnimeGo player response has no content.");
    }

    private static IReadOnlyList<SourceItem> ParseCurrentSearch(string html, string title)
    {
        var normalized = ProviderParsing.NormalizeTitle(title);
        var items = new List<SourceItem>();
        foreach (var block in CurrentCardStartRegex().Split(html))
        {
            var idMatch = CurrentIdRegex().Match(block);
            var titleMatch = CurrentTitleRegex().Match(block);
            if (!idMatch.Success || !titleMatch.Success)
                continue;
            var name = WebUtility.HtmlDecode(StripTags(titleMatch.Groups[1].Value)).Trim();
            var original = WebUtility.HtmlDecode(StripTags(CurrentOriginalRegex().Match(block).Groups[1].Value)).Trim();
            var normalizedName = ProviderParsing.NormalizeTitle(name);
            var normalizedOriginal = ProviderParsing.NormalizeTitle(original);
            if (!normalizedName.Contains(normalized, StringComparison.Ordinal) &&
                !normalizedOriginal.Contains(normalized, StringComparison.Ordinal) &&
                !normalized.Contains(normalizedName, StringComparison.Ordinal) &&
                !normalized.Contains(normalizedOriginal, StringComparison.Ordinal))
                continue;
            var yearText = CurrentYearRegex().Match(block).Groups[1].Value;
            var poster = CurrentPosterRegex().Match(block).Groups[1].Value;
            var isMovie = block.Contains(">Фильм<", StringComparison.OrdinalIgnoreCase);
            items.Add(new SourceItem(
                "animego",
                "AnimeGo",
                idMatch.Groups[1].Value,
                name,
                string.IsNullOrWhiteSpace(original) ? null : original,
                int.TryParse(yearText, out var year) ? year : null,
                string.IsNullOrWhiteSpace(poster) ? null : WebUtility.HtmlDecode(poster),
                "1080p",
                null,
                isMovie ? "movie" : "tv"));
        }
        return items.DistinctBy(item => item.SourceId).ToArray();
    }

    private static IReadOnlyList<SourceItem> ParseLegacySearch(string html, string title)
    {
        var normalized = ProviderParsing.NormalizeTitle(title);
        var items = new List<SourceItem>();
        foreach (var block in html.Split("p-poster__stack", StringSplitOptions.RemoveEmptyEntries))
        {
            var sourceId = LegacyIdRegex().Match(block).Groups[1].Value;
            var name = WebUtility.HtmlDecode(LegacyTitleRegex().Match(block).Groups[1].Value).Trim();
            if (string.IsNullOrWhiteSpace(sourceId) || string.IsNullOrWhiteSpace(name))
                continue;
            if (!ProviderParsing.NormalizeTitle(name).Contains(normalized, StringComparison.Ordinal) &&
                !normalized.Contains(ProviderParsing.NormalizeTitle(name), StringComparison.Ordinal))
                continue;
            var yearText = LegacyYearRegex().Match(block).Groups[1].Value;
            var poster = LegacyPosterRegex().Match(block).Groups[1].Value;
            items.Add(new SourceItem(
                "animego", "AnimeGo", sourceId, name, null,
                int.TryParse(yearText, out var year) ? year : null,
                string.IsNullOrWhiteSpace(poster) ? null : WebUtility.HtmlDecode(poster),
                "1080p", null, "tv"));
        }
        return items;
    }

    private static IReadOnlyList<AnimeGoEpisode> ParseCurrentEpisodes(string html) => CurrentEpisodeRegex().Matches(html)
        .Select((match, index) => new AnimeGoEpisode(
            ProviderParsing.EpisodeNumber(match.Groups[1].Value, index + 1),
            match.Groups[2].Value))
        .ToArray();

    private static IReadOnlyList<CurrentPlayer> ParseCurrentPlayers(string html)
    {
        var players = new List<CurrentPlayer>();
        foreach (Match match in CurrentPlayerButtonRegex().Matches(html))
        {
            var attributes = match.Groups[1].Value;
            var url = Attribute(attributes, "data-player");
            var provider = Attribute(attributes, "data-provider-slug").ToLowerInvariant();
            var voice = Attribute(attributes, "data-translation-title");
            if (string.IsNullOrWhiteSpace(url) || provider is not ("kodik" or "aniboom"))
                continue;
            players.Add(new CurrentPlayer(provider, WebUtility.HtmlDecode(url), WebUtility.HtmlDecode(voice)));
        }
        return players;
    }

    private static string Attribute(string attributes, string name) => Regex.Match(
        attributes,
        $"(?:^|\\s){Regex.Escape(name)}=\"([^\"]*)\"",
        RegexOptions.IgnoreCase).Groups[1].Value;

    private static string StripTags(string value) => Regex.Replace(value, "<[^>]+>", string.Empty);
    private static int ParseInt(string value, int fallback) => int.TryParse(value, out var result) ? result : fallback;

    private static void AddAjaxHeaders(HttpRequestMessage request)
    {
        request.Headers.TryAddWithoutValidation("DNT", "1");
        request.Headers.TryAddWithoutValidation("Pragma", "no-cache");
        request.Headers.TryAddWithoutValidation("X-Requested-With", "XMLHttpRequest");
    }

    private static bool IsAniBoomHost(string value) =>
        value.Equals("aniboom.one", StringComparison.OrdinalIgnoreCase) ||
        value.StartsWith("aniboom.", StringComparison.OrdinalIgnoreCase);

    [GeneratedRegex("href=\"/anime/[^\"]+-([0-9]+)\"")]
    private static partial Regex CurrentIdRegex();
    [GeneratedRegex("(?=<(?:div|article)[^>]*class=\"(?:[^\"]*\\s)?ani-grid__item(?:\\s[^\"]*)?\"[^>]*>)", RegexOptions.IgnoreCase)]
    private static partial Regex CurrentCardStartRegex();
    [GeneratedRegex("ani-grid__item-title[^>]*>\\s*<a[^>]*>(.*?)</a>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex CurrentTitleRegex();
    [GeneratedRegex("fw-lighter small[^>]*>(.*?)</div>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex CurrentOriginalRegex();
    [GeneratedRegex("ani-grid__item-genres[\\s\\S]*?>\\s*([0-9]{4})\\s*</span>", RegexOptions.IgnoreCase)]
    private static partial Regex CurrentYearRegex();
    [GeneratedRegex("<img[^>]+src=\"([^\"]+)\"", RegexOptions.IgnoreCase)]
    private static partial Regex CurrentPosterRegex();
    [GeneratedRegex("data-episode-number=\"([0-9]+(?:\\.[0-9]+)?)\"[\\s\\S]*?data-episode=\"([0-9]+)\"", RegexOptions.IgnoreCase)]
    private static partial Regex CurrentEpisodeRegex();
    [GeneratedRegex("data-anime-player-episodes-total-value=\"([0-9]+)\"", RegexOptions.IgnoreCase)]
    private static partial Regex TotalEpisodesRegex();
    [GeneratedRegex("data-anime-player-episodes-page-size-value=\"([0-9]+)\"", RegexOptions.IgnoreCase)]
    private static partial Regex PageSizeRegex();
    [GeneratedRegex("<button\\s+([^>]*data-player=\"[^\"]+\"[^>]*)>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex CurrentPlayerButtonRegex();

    [GeneratedRegex("data-ajax-url=\"/[^\"]+-([0-9]+)\"", RegexOptions.IgnoreCase)]
    private static partial Regex LegacyIdRegex();
    [GeneratedRegex("card-title text-truncate\"><a [^>]+>([^<]+)<", RegexOptions.IgnoreCase)]
    private static partial Regex LegacyTitleRegex();
    [GeneratedRegex("anime-year\"><a [^>]*>([0-9]{4})<", RegexOptions.IgnoreCase)]
    private static partial Regex LegacyYearRegex();
    [GeneratedRegex("data-original=\"([^\"]+)\"", RegexOptions.IgnoreCase)]
    private static partial Regex LegacyPosterRegex();
    [GeneratedRegex("data-player=\"(?:https?:)?//(aniboom\\.[^/]+)/embed/([^\"?&]+)\\?episode=1(?:&amp;|&)translation=([0-9]+)\"", RegexOptions.IgnoreCase)]
    private static partial Regex LegacyPlayerRegex();
    [GeneratedRegex("data-episode=\"([0-9]+(?:\\.[0-9]+)?)\"", RegexOptions.IgnoreCase)]
    private static partial Regex LegacyEpisodeRegex();
    [GeneratedRegex("data-player=\"(?:https?:)?//aniboom\\.[^/]+/embed/[^\"?&]+\\?episode=[0-9.]+(?:&amp;|&)translation=([0-9]+)\"\\s+data-provider=\"[0-9]+\"\\s+data-provide-dubbing=\"([0-9]+)\"", RegexOptions.IgnoreCase)]
    private static partial Regex LegacyTranslationRegex();
    [GeneratedRegex("\"hls\":\"\\{\"src\":\"((?:https?:)?//[^\"]+\\.m3u8[^\"]*)", RegexOptions.IgnoreCase)]
    private static partial Regex HlsRegex();
    [GeneratedRegex("^[a-zA-Z0-9._-]+$")]
    private static partial Regex SafeTokenRegex();

    private enum PlaylistMode { Current, Legacy }
    private sealed record AnimeGoLocator(string Mode, string? EpisodeId, string? EmbedHost, string? Token, string? TranslationId);
    private sealed record AnimeGoEpisode(double Number, string? InternalId);
    private sealed record Translation(string Id, string Name);
    private sealed record CurrentPlayer(string Provider, string Url, string Voice);
    private sealed record Playlist(
        PlaylistMode Mode,
        string? EmbedHost,
        string? Token,
        string? DefaultTranslation,
        IReadOnlyList<AnimeGoEpisode> Episodes,
        IReadOnlyList<Translation> Translations);
}
