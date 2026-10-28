using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers.Providers;

public sealed partial class LeProductionProvider(HttpClient http, IMemoryCache? cache = null)
    : ProviderBase(http, cache), IOnlineProvider
{
    private const string Host = "https://www.le-production.tv";

    public string Id => "leproduction";
    public string Name => "LeProduction";
    public ProviderDescriptor Descriptor => new(Id, Name, "movies");

    public async Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        var title = query.OriginalTitle ?? query.Title;
        if (string.IsNullOrWhiteSpace(title))
            return [];
        var html = await CachedAsync(
            $"leproduction:search:{ProviderParsing.NormalizeTitle(title)}",
            TimeSpan.FromHours(4),
            () => GetStringAsync(Get(
                $"{Host}/index.php?do=search&subaction=search&search_start=0&full_search=0&result_from=1&story={Uri.EscapeDataString(title)}",
                Host), cancellationToken));

        var items = new List<SourceItem>();
        foreach (Match match in SearchCardRegex().Matches(html))
        {
            var href = WebUtility.HtmlDecode(match.Groups[1].Value);
            var name = WebUtility.HtmlDecode(StripTags(match.Groups[2].Value)).Trim();
            if (string.IsNullOrWhiteSpace(href) || string.IsNullOrWhiteSpace(name))
                continue;
            var yearMatch = YearRegex().Match(match.Value);
            var imageMatch = ImageRegex().Match(match.Value);
            var poster = imageMatch.Success ? new Uri(new Uri(Host), imageMatch.Groups[1].Value).ToString() : null;
            items.Add(new SourceItem(
                Id,
                Name,
                href.TrimStart('/'),
                name,
                null,
                yearMatch.Success && int.TryParse(yearMatch.Groups[1].Value, out var year) ? year : query.Year,
                poster,
                "1080p",
                "LE-Production",
                query.Type == "movie" ? "movie" : "tv"));
        }
        return items.DistinctBy(item => item.SourceId).Take(20).ToArray();
    }

    public async Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken)
    {
        var media = await LoadMediaAsync(selection.SourceId, cancellationToken);
        if (media.MovieStreams.Count > 0)
            return new EpisodesResult([], 0);
        var episodes = media.Episodes.Select((item, index) =>
        {
            var locator = LocatorCodec.Encode(new LeProductionLocator(item.Streams[0].Url, item.Streams[0].Quality));
            return new EpisodeItem(
                $"{Id}:{selection.SourceId}:{item.Season}:{item.Number}",
                item.Season,
                item.Number,
                $"{item.Number:g} серия",
                locator,
                Name,
                [new AudioItem($"{Id}:{index}", Name, locator)]);
        }).ToArray();
        return new EpisodesResult(episodes, episodes.Length == 0 ? 0 : episodes.Max(item => item.Season));
    }

    public async Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(selection.Locator))
        {
            var locator = LocatorCodec.Decode<LeProductionLocator>(selection.Locator);
            return new ResolvedPlayback(locator.Url, locator.Quality, Name);
        }

        var media = await LoadMediaAsync(selection.SourceId, cancellationToken);
        var stream = media.MovieStreams.OrderByDescending(item => QualityNumber(item.Quality)).FirstOrDefault()
            ?? throw new ProviderException("LeProduction did not return a playable stream.");
        return new ResolvedPlayback(stream.Url, stream.Quality, Name);
    }

    private async Task<LeProductionMedia> LoadMediaAsync(string sourceId, CancellationToken cancellationToken)
    {
        if (sourceId.Contains("..", StringComparison.Ordinal) || Uri.TryCreate(sourceId, UriKind.Absolute, out _))
            throw new ProviderException("LeProduction source id is invalid.");
        var pageUrl = new Uri(new Uri(Host + "/"), sourceId.TrimStart('/')).ToString();
        var page = await GetStringAsync(Get(pageUrl, Host), cancellationToken);
        var iframeMatch = IframeRegex().Match(page);
        if (!iframeMatch.Success)
            throw new ProviderException("LeProduction player was not found.");
        var iframeUrl = new Uri(new Uri(pageUrl), WebUtility.HtmlDecode(iframeMatch.Groups[1].Value)).ToString();
        var iframe = await GetStringAsync(Get(iframeUrl, pageUrl), cancellationToken);
        var fileMatch = FileBlockRegex().Match(iframe);
        if (!fileMatch.Success)
            throw new ProviderException("LeProduction playlist was not found.");
        var fileBlock = fileMatch.Groups[1].Value.Trim().TrimEnd(',');
        if (!fileBlock.Contains("серия", StringComparison.OrdinalIgnoreCase))
            return new LeProductionMedia(ParseStreams(fileBlock), []);

        try
        {
            var serial = JsonSerializer.Deserialize<LeProductionSerial[]>(fileBlock, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                AllowTrailingCommas = true,
            }) ?? [];
            var episodes = serial.Select((item, index) =>
            {
                var season = ParseCommentNumber(item.Comment, "сезон", 1);
                var episode = ParseCommentNumber(item.Comment, "серия", index + 1);
                return new LeProductionEpisode(season, episode, ParseStreams(item.File ?? string.Empty));
            }).Where(item => item.Streams.Count > 0).ToArray();
            return new LeProductionMedia([], episodes);
        }
        catch (JsonException)
        {
            throw new ProviderException("LeProduction playlist format is invalid.");
        }
    }

    private static IReadOnlyList<LeProductionStream> ParseStreams(string value) => QualityRegex().Matches(value)
        .Select(match => new LeProductionStream(
            ProviderParsing.AbsoluteHttps(match.Groups[2].Value),
            match.Groups[1].Value))
        .OrderByDescending(item => QualityNumber(item.Quality))
        .ToArray();

    private static int ParseCommentNumber(string? comment, string label, int fallback)
    {
        var match = Regex.Match(comment ?? string.Empty, $"([0-9]+)\\s*{label}", RegexOptions.IgnoreCase);
        return match.Success && int.TryParse(match.Groups[1].Value, out var value) ? value : fallback;
    }

    private static int QualityNumber(string quality) => int.TryParse(NonDigitRegex().Replace(quality, string.Empty), out var value) ? value : 0;
    private static string StripTags(string value) => TagsRegex().Replace(value, string.Empty);

    private sealed record LeProductionLocator(string Url, string Quality);
    private sealed record LeProductionMedia(
        IReadOnlyList<LeProductionStream> MovieStreams,
        IReadOnlyList<LeProductionEpisode> Episodes);
    private sealed record LeProductionStream(string Url, string Quality);
    private sealed record LeProductionEpisode(int Season, int Number, IReadOnlyList<LeProductionStream> Streams);
    private sealed class LeProductionSerial
    {
        public string? Comment { get; init; }
        public string? File { get; init; }
    }

    [GeneratedRegex("<div[^>]*class=\\\"[^\\\"]*short-item[^\\\"]*\\\"[^>]*>(.*?)</div>\\s*</div>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex SearchBlockRegex();
    [GeneratedRegex("<div[^>]*class=\\\"[^\\\"]*short-item[^\\\"]*\\\"[^>]*>.*?href=\\\"(?:https?://[^/]+)?/([^\\\"]+\\.html)\\\".*?<h3[^>]*>.*?<a[^>]*>(.*?)</a>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex SearchCardRegex();
    [GeneratedRegex("((?:19|20)[0-9]{2})")]
    private static partial Regex YearRegex();
    [GeneratedRegex("(?:src|data-src)=\\\"([^\\\"]+)\\\"", RegexOptions.IgnoreCase)]
    private static partial Regex ImageRegex();
    [GeneratedRegex("<iframe[^>]+(?:id=\\\"omfg\\\"[^>]+)?src=\\\"([^\\\"]+)\\\"", RegexOptions.IgnoreCase)]
    private static partial Regex IframeRegex();
    [GeneratedRegex("file\\s*:\\s*(.*?)\\s*,?\\s*embed\\s*:", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex FileBlockRegex();
    [GeneratedRegex("\\[([0-9]+p)\\](https?://[^,\\[\\\"\\s]+)", RegexOptions.IgnoreCase)]
    private static partial Regex QualityRegex();
    [GeneratedRegex("<[^>]+>")]
    private static partial Regex TagsRegex();
    [GeneratedRegex("[^0-9]")]
    private static partial Regex NonDigitRegex();
}
