using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers.Providers;

public sealed partial class RezkaProvider(HttpClient http, IMemoryCache? cache = null)
    : ProviderBase(http, cache), IOnlineProvider
{
    public string Id => IdValue;
    public string Name => "Rezka";
    public ProviderDescriptor Descriptor => new(Id, Name, "general", "account", "session");

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken) =>
        throw AccountRequired();

    public Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken) =>
        throw AccountRequired();

    public Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken) =>
        throw AccountRequired();

    public async Task<IReadOnlyList<SourceItem>> SearchAsync(
        MediaQuery query,
        ProviderRequestContext context,
        CancellationToken cancellationToken)
    {
        var account = ReadAccount(context);
        var title = query.OriginalTitle ?? query.Title;
        if (string.IsNullOrWhiteSpace(title))
            return [];
        var url = $"{account.Host}/search/?do=search&subaction=search&q={Uri.EscapeDataString(title)}";
        var html = await SendStringAsync(GetWithAccount(url, account, account.Host + "/"), cancellationToken);
        return SearchCardRegex().Matches(html).Select(match =>
        {
            var cardTitle = Clean(match.Groups["title"].Value);
            var path = WebUtility.HtmlDecode(match.Groups["path"].Value);
            var poster = WebUtility.HtmlDecode(match.Groups["poster"].Value);
            var year = int.TryParse(match.Groups["year"].Value, out var number) ? number : (int?)null;
            return new SourceItem(
                IdValue,
                "Rezka",
                path,
                cardTitle,
                null,
                year,
                string.IsNullOrWhiteSpace(poster) ? null : Absolute(account.Host, poster),
                "1080p",
                null,
                CardMediaType(match.Value));
        }).Where(item => !string.IsNullOrWhiteSpace(item.Title)).ToArray();
    }

    public async Task<EpisodesResult> GetEpisodesAsync(
        SourceSelection selection,
        ProviderRequestContext context,
        CancellationToken cancellationToken)
    {
        var account = ReadAccount(context);
        var detailUrl = Absolute(account.Host, selection.SourceId);
        var html = await SendStringAsync(GetWithAccount(detailUrl, account, detailUrl), cancellationToken);
        var metadata = ParseMetadata(html, selection.SourceId);
        if (!metadata.IsSeries)
            return new EpisodesResult([], 0);

        var grouped = new Dictionary<(int Season, int Episode), EpisodeAccumulator>();
        foreach (var translator in metadata.Translators)
        {
            using var response = await PostPlayerAsync(
                account,
                detailUrl,
                new Dictionary<string, string>
                {
                    ["id"] = metadata.Id.ToString(CultureInfo.InvariantCulture),
                    ["translator_id"] = translator.Id.ToString(CultureInfo.InvariantCulture),
                    ["action"] = "get_episodes",
                },
                cancellationToken);
            if (!TryString(response.RootElement, "episodes", out var episodeHtml))
                continue;
            foreach (Match match in EpisodeRegex().Matches(episodeHtml))
            {
                if (!int.TryParse(match.Groups["season"].Value, out var season) ||
                    !int.TryParse(match.Groups["episode"].Value, out var episode))
                    continue;
                var key = (season, episode);
                if (!grouped.TryGetValue(key, out var accumulator))
                {
                    accumulator = new EpisodeAccumulator(Clean(match.Groups["title"].Value));
                    grouped[key] = accumulator;
                }
                var locator = LocatorCodec.Encode(new RezkaLocator(
                    selection.SourceId,
                    metadata.Id,
                    translator.Id,
                    season,
                    episode,
                    metadata.Favs,
                    metadata.Director,
                    translator.Name));
                accumulator.Audios.Add(new AudioItem(
                    $"{IdValue}:{season}:{episode}:{translator.Id}",
                    translator.Name,
                    locator));
            }
        }

        var episodes = grouped.OrderBy(item => item.Key.Season).ThenBy(item => item.Key.Episode).Select(item =>
        {
            var first = item.Value.Audios[0];
            return new EpisodeItem(
                Id: $"{IdValue}:{selection.SourceId}:{item.Key.Season}:{item.Key.Episode}",
                Season: item.Key.Season,
                Number: item.Key.Episode,
                Title: string.IsNullOrWhiteSpace(item.Value.Title) ? $"{item.Key.Episode} серия" : item.Value.Title,
                Voice: first.Name,
                Url: null,
                Audios: item.Value.Audios,
                Locator: first.Locator);
        }).ToArray();
        return new EpisodesResult(episodes, episodes.Length == 0 ? 0 : episodes.Max(item => item.Season));
    }

    public async Task<ResolvedPlayback> ResolveAsync(
        PlaybackSelection selection,
        ProviderRequestContext context,
        CancellationToken cancellationToken)
    {
        var account = ReadAccount(context);
        var detailUrl = Absolute(account.Host, selection.SourceId);
        RezkaLocator locator;
        if (!string.IsNullOrWhiteSpace(selection.Locator))
        {
            locator = LocatorCodec.Decode<RezkaLocator>(selection.Locator);
        }
        else
        {
            var html = await SendStringAsync(GetWithAccount(detailUrl, account, detailUrl), cancellationToken);
            var metadata = ParseMetadata(html, selection.SourceId);
            var translator = metadata.Translators.FirstOrDefault()
                ?? throw new ProviderException("Rezka did not return translations.");
            locator = new RezkaLocator(
                selection.SourceId,
                metadata.Id,
                translator.Id,
                selection.Season,
                selection.Episode is null ? null : (int)selection.Episode.Value,
                metadata.Favs,
                metadata.Director,
                translator.Name);
        }

        var fields = new Dictionary<string, string>
        {
            ["id"] = locator.Id.ToString(CultureInfo.InvariantCulture),
            ["translator_id"] = locator.TranslatorId.ToString(CultureInfo.InvariantCulture),
            ["favs"] = locator.Favs ?? string.Empty,
        };
        if (locator.Season is > 0 && locator.Episode is > 0)
        {
            fields["season"] = locator.Season.Value.ToString(CultureInfo.InvariantCulture);
            fields["episode"] = locator.Episode.Value.ToString(CultureInfo.InvariantCulture);
            fields["action"] = "get_stream";
        }
        else
        {
            fields["is_camrip"] = "0";
            fields["is_ads"] = "0";
            fields["is_director"] = locator.Director ? "1" : "0";
            fields["action"] = "get_movie";
        }

        using var response = await PostPlayerAsync(account, detailUrl, fields, cancellationToken);
        if (!TryString(response.RootElement, "url", out var encoded))
            throw new ProviderException("Rezka did not return a playable stream.");
        var streams = ParseStreams(DecodePlaylist(encoded));

        var best = streams.OrderByDescending(item => QualityNumber(item.Quality)).FirstOrDefault()
            ?? throw new ProviderException("Rezka returned an empty playlist.");
        return new ResolvedPlayback(
            best.Url,
            best.Quality,
            locator.Voice,
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["Referer"] = detailUrl,
                ["Origin"] = account.Host,
                ["Cookie"] = account.Cookie,
            });
    }

    private async Task<JsonDocument> PostPlayerAsync(
        RezkaAccount account,
        string referer,
        IReadOnlyDictionary<string, string> fields,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"{account.Host}/ajax/get_cdn_series/?t={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}");
        request.Content = new FormUrlEncodedContent(fields);
        ApplyAccountHeaders(request, account, referer);
        request.Headers.TryAddWithoutValidation("X-Requested-With", "XMLHttpRequest");
        request.Headers.TryAddWithoutValidation("Accept", "application/json, text/javascript, */*; q=0.01");
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonDocument>(cancellationToken: cancellationToken)
            ?? throw new ProviderException("Rezka returned an empty response.");
    }

    private async Task<string> SendStringAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        try
        {
            return await GetStringAsync(request, cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            throw new ProviderException("Rezka account request failed.");
        }
    }

    private static HttpRequestMessage GetWithAccount(string url, RezkaAccount account, string referer)
    {
        var request = Get(url, referer);
        ApplyAccountHeaders(request, account, referer);
        return request;
    }

    private static void ApplyAccountHeaders(HttpRequestMessage request, RezkaAccount account, string referer)
    {
        request.Headers.TryAddWithoutValidation("Cookie", account.Cookie);
        request.Headers.TryAddWithoutValidation("Origin", account.Host);
        request.Headers.Referrer = new Uri(referer);
    }

    private static RezkaAccount ReadAccount(ProviderRequestContext context)
    {
        var values = context.RequireAccount(IdValue, "cookie", "host", "label");
        if (!values.TryGetValue("cookie", out var cookie) || string.IsNullOrWhiteSpace(cookie))
            throw new ProviderException("Rezka account is incomplete.");
        var host = values.TryGetValue("host", out var configuredHost) ? configuredHost : "https://rezka.ag";
        return new RezkaAccount(ValidateHost(host), cookie);
    }

    internal static string ValidateHost(string value)
    {
        var normalized = value.Trim().TrimEnd('/');
        if (!Uri.TryCreate(normalized, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps ||
            !uri.Host.Contains("rezka", StringComparison.OrdinalIgnoreCase) || uri.IsLoopback)
            throw new ProviderException("Rezka host is invalid.");
        return uri.GetLeftPart(UriPartial.Authority);
    }

    private static RezkaMetadata ParseMetadata(string html, string sourceId)
    {
        var idMatch = PlayerIdRegex().Match(html);
        if (!long.TryParse(idMatch.Groups["id"].Value, out var id))
            throw new ProviderException("Rezka player id was not found.");
        var translators = TranslatorRegex().Matches(html).Select(match =>
        {
            _ = int.TryParse(match.Groups["id"].Value, out var translatorId);
            var name = Clean(match.Groups["name"].Value);
            return new RezkaTranslator(translatorId, string.IsNullOrWhiteSpace(name) ? $"Перевод {translatorId}" : name);
        }).Where(item => item.Id > 0).DistinctBy(item => item.Id).ToArray();
        if (translators.Length == 0)
        {
            var fallback = FallbackTranslatorRegex().Match(html);
            if (int.TryParse(fallback.Groups["id"].Value, out var translatorId))
                translators = [new RezkaTranslator(translatorId, "Основной поток")];
        }
        var favs = FavsRegex().Match(html).Groups["value"].Value;
        var director = html.Contains("data-director=\"1\"", StringComparison.OrdinalIgnoreCase);
        var isSeries = html.Contains("data-season_id=", StringComparison.OrdinalIgnoreCase)
            || html.Contains("initCDNSeriesEvents", StringComparison.OrdinalIgnoreCase);
        return new RezkaMetadata(sourceId, id, favs, director, isSeries, translators);
    }

    internal static string DecodePlaylist(string value)
    {
        if (!value.StartsWith('#'))
            return value.Replace("\\/", "/", StringComparison.Ordinal);
        var payload = value.Length > 2 ? value[2..] : string.Empty;
        foreach (var marker in CurrentTrashMarkers)
            payload = payload.Replace("//_//" + marker, string.Empty, StringComparison.Ordinal);
        payload = Regex.Replace(payload, "//[^/]+_//", string.Empty).Replace("//_//", string.Empty, StringComparison.Ordinal);
        try
        {
            return Encoding.UTF8.GetString(Convert.FromBase64String(payload));
        }
        catch (FormatException)
        {
            throw new ProviderException("Rezka returned an invalid playlist.");
        }
    }

    internal static IReadOnlyList<RezkaStream> ParseStreams(string value) =>
        StreamRegex().Matches(value).Select(match =>
        {
            var links = match.Groups["links"].Value.Split(" or ", StringSplitOptions.RemoveEmptyEntries);
            var url = links.Select(link => UrlRegex().Match(link).Groups["url"].Value)
                .FirstOrDefault(candidate => candidate.EndsWith(".m3u8", StringComparison.OrdinalIgnoreCase))
                ?? links.Select(link => UrlRegex().Match(link).Groups["url"].Value)
                    .FirstOrDefault(candidate => !string.IsNullOrWhiteSpace(candidate));
            return new RezkaStream(match.Groups["quality"].Value, url ?? string.Empty);
        }).Where(item => !string.IsNullOrWhiteSpace(item.Url))
            .Select(item => item with { Url = ProviderParsing.AbsoluteHttps(item.Url.Replace(":hls:manifest.m3u8", string.Empty)) })
            .ToArray();

    private static bool TryString(JsonElement element, string name, out string value)
    {
        if (element.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String)
        {
            value = property.GetString() ?? string.Empty;
            return !string.IsNullOrWhiteSpace(value);
        }
        value = string.Empty;
        return false;
    }

    private static string Absolute(string host, string value)
    {
        if (Uri.TryCreate(value, UriKind.Absolute, out var absolute))
            return absolute.ToString();
        return new Uri(new Uri(host + "/"), value.TrimStart('/')).ToString();
    }

    private static string Clean(string value) => WebUtility.HtmlDecode(StripTagsRegex().Replace(value, string.Empty)).Trim();
    private static string CardMediaType(string value) =>
        value.Contains("сериал", StringComparison.OrdinalIgnoreCase) ? "tv" : "movie";
    private static int QualityNumber(string value)
    {
        if (value.Contains("4K", StringComparison.OrdinalIgnoreCase)) return 2160;
        if (value.Contains("2K", StringComparison.OrdinalIgnoreCase)) return 1440;
        var digits = new string(value.Where(char.IsDigit).ToArray());
        return int.TryParse(digits, out var quality) ? quality : 0;
    }

    private static ProviderException AccountRequired() =>
        new($"An account is required for provider '{IdValue}'.");

    private const string IdValue = "rezka";
    private static readonly string[] CurrentTrashMarkers =
    [
        "JCQhIUAkJEBeIUAjJCRA",
        "QEBAQEAhIyMhXl5e",
        "IyMjI14hISMjIUBA",
        "Xl5eIUAjIyEhIyM=",
        "JCQjISFAIyFAIyM=",
    ];

    private sealed record RezkaAccount(string Host, string Cookie);
    private sealed record RezkaTranslator(int Id, string Name);
    private sealed record RezkaMetadata(
        string SourceId,
        long Id,
        string? Favs,
        bool Director,
        bool IsSeries,
        IReadOnlyList<RezkaTranslator> Translators);
    private sealed record RezkaLocator(
        string SourceId,
        long Id,
        int TranslatorId,
        int? Season,
        int? Episode,
        string? Favs,
        bool Director,
        string? Voice);
    internal sealed record RezkaStream(string Quality, string Url);
    private sealed class EpisodeAccumulator(string title)
    {
        public string Title { get; } = title;
        public List<AudioItem> Audios { get; } = [];
    }

    [GeneratedRegex("class=\"[^\"]*b-content__inline_item[^\"]*\".*?href=\"(?:https?://[^/]+)?/(?<path>[^\"]+)\"[^>]*>(?<title>.*?)</a>.*?<div[^>]*>(?<year>[0-9]{4}).*?<img[^>]+(?:src|data-src)=\"(?<poster>[^\"]+)\"", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex SearchCardRegex();
    [GeneratedRegex("(?:initCDNSeriesEvents\\(|initCDNMoviesEvents\\(|data-id=\")(?<id>[0-9]+)", RegexOptions.IgnoreCase)]
    private static partial Regex PlayerIdRegex();
    [GeneratedRegex("data-translator_id=\"(?<id>[0-9]+)\"[^>]*>(?<name>[^<]*)", RegexOptions.IgnoreCase)]
    private static partial Regex TranslatorRegex();
    [GeneratedRegex("initCDN(?:Series|Movies)Events\\([0-9]+\\s*,\\s*(?<id>[0-9]+)", RegexOptions.IgnoreCase)]
    private static partial Regex FallbackTranslatorRegex();
    [GeneratedRegex("data-favs=\"(?<value>[^\"]*)\"", RegexOptions.IgnoreCase)]
    private static partial Regex FavsRegex();
    [GeneratedRegex("data-season_id=\"(?<season>[0-9]+)\"[^>]*data-episode_id=\"(?<episode>[0-9]+)\"[^>]*>(?<title>[^<]*)</li>", RegexOptions.IgnoreCase)]
    private static partial Regex EpisodeRegex();
    [GeneratedRegex("\\[(?<quality>[^\\]]+)\\](?<links>[^,\\[]+)", RegexOptions.IgnoreCase)]
    private static partial Regex StreamRegex();
    [GeneratedRegex("(?<url>https?://[^\\[\\s,]+)", RegexOptions.IgnoreCase)]
    private static partial Regex UrlRegex();
    [GeneratedRegex("<[^>]+>")]
    private static partial Regex StripTagsRegex();
}
