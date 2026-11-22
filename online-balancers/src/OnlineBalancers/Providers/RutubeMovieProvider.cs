using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers.Providers;

public sealed partial class RutubeMovieProvider(HttpClient http, IMemoryCache? cache = null)
    : ProviderBase(http, cache), IOnlineProvider
{
    private const string Host = "https://rutube.ru";
    private const int MinimumMovieDurationSeconds = 3_000;

    private static readonly string[] ExcludedTitleMarkers =
    [
        "трейлер",
        "trailer",
        "обзор",
        "сезон",
        "сериал",
        "серия",
        "серий",
    ];

    public string Id => "rutubemovie";
    public string Name => "RUTUBE";
    public ProviderDescriptor Descriptor => new(Id, Name, "movies");

    public async Task<IReadOnlyList<SourceItem>> SearchAsync(
        MediaQuery query,
        CancellationToken cancellationToken)
    {
        if (!IsMovieType(query.Type))
            return [];

        var searchTitles = new[] { query.Title, query.OriginalTitle }
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (searchTitles.Length == 0)
            return [];

        var expectedTitles = searchTitles
            .Select(ProviderParsing.NormalizeTitle)
            .Where(value => value.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (expectedTitles.Length == 0)
            return [];

        var roots = await Task.WhenAll(searchTitles.Select(async searchTitle =>
        {
            var search = query.Year is > 0 ? $"{searchTitle} {query.Year.Value}" : searchTitle;
            return await CachedAsync(
                $"rutubemovie:search:{ProviderParsing.NormalizeTitle(search)}",
                TimeSpan.FromMinutes(20),
                () => GetJsonAsync<RutubeSearchRoot>(
                    Get($"{Host}/api/search/video/?content_type=video&duration=movie&query={Uri.EscapeDataString(search)}", Host),
                    cancellationToken));
        }));

        return roots.SelectMany(root => root.Results ?? [])
            .Where(item => IsMovieCandidate(item, expectedTitles, query.Year))
            .DistinctBy(item => item.Id, StringComparer.OrdinalIgnoreCase)
            .Take(8)
            .Select(item => new SourceItem(
                Id,
                Name,
                item.Id!,
                item.Title!,
                query.OriginalTitle,
                MatchedYear(item.Title!, query.Year),
                item.ThumbnailUrl,
                "Auto",
                null,
                "movie"))
            .ToArray();
    }

    public Task<EpisodesResult> GetEpisodesAsync(
        SourceSelection selection,
        CancellationToken cancellationToken) =>
        Task.FromResult(new EpisodesResult([], 0));

    public async Task<ResolvedPlayback> ResolveAsync(
        PlaybackSelection selection,
        CancellationToken cancellationToken)
    {
        if (!RutubeIdRegex().IsMatch(selection.SourceId))
            throw new ProviderException("RUTUBE video id is invalid.");

        var options = await GetJsonAsync<RutubePlayOptions>(
            Get($"{Host}/api/play/options/{selection.SourceId}/?no_404=true&referer=&pver=v2&client=wdp", Host),
            cancellationToken);
        var hls = options.VideoBalancer?.M3u8;
        if (string.IsNullOrWhiteSpace(hls))
            throw new ProviderException("RUTUBE did not return a playable stream.");

        return new ResolvedPlayback(
            ProviderParsing.AbsoluteHttps(hls),
            "Auto",
            Headers: new Dictionary<string, string> { ["Referer"] = $"{Host}/" });
    }

    private static bool IsMovieCandidate(RutubeSearchResult item, IReadOnlyList<string> expectedTitles, int? year)
    {
        if (string.IsNullOrWhiteSpace(item.Id) || !RutubeIdRegex().IsMatch(item.Id) ||
            string.IsNullOrWhiteSpace(item.Title) || item.Duration < MinimumMovieDurationSeconds ||
            item.IsHidden || item.IsDeleted || item.IsAdult ||
            item.IsLocked || item.IsAudio || item.IsPaid || item.IsLivestream)
            return false;

        var normalized = ProviderParsing.NormalizeTitle(item.Title);
        if (!expectedTitles.Any(expected => normalized.Contains(expected, StringComparison.Ordinal)))
            return false;
        if (ExcludedTitleMarkers.Any(marker => normalized.Contains(marker, StringComparison.Ordinal)))
            return false;

        var years = YearRegex().Matches(item.Title)
            .Select(match => int.TryParse(match.Value, out var parsed) ? parsed : 0)
            .Where(candidate => candidate > 0)
            .ToArray();
        return year is not > 0 || years.Length == 0 || years.Any(candidate => Math.Abs(candidate - year.Value) <= 1);
    }

    private static int? MatchedYear(string title, int? expectedYear)
    {
        var years = YearRegex().Matches(title)
            .Select(match => int.TryParse(match.Value, out var parsed) ? parsed : 0)
            .Where(year => year > 0)
            .ToArray();
        if (years.Length == 0)
            return null;
        return expectedYear is > 0
            ? years.OrderBy(year => Math.Abs(year - expectedYear.Value)).First()
            : years[0];
    }

    private static bool IsMovieType(string? value) => value?.Trim().ToLowerInvariant() is "movie" or "film";

    private sealed class RutubeSearchRoot
    {
        [JsonPropertyName("results")]
        public List<RutubeSearchResult>? Results { get; init; }
    }

    private sealed class RutubeSearchResult
    {
        [JsonPropertyName("id")]
        public string? Id { get; init; }

        [JsonPropertyName("title")]
        public string? Title { get; init; }

        [JsonPropertyName("duration")]
        public long Duration { get; init; }

        [JsonPropertyName("thumbnail_url")]
        public string? ThumbnailUrl { get; init; }

        [JsonPropertyName("is_hidden")]
        public bool IsHidden { get; init; }

        [JsonPropertyName("is_deleted")]
        public bool IsDeleted { get; init; }

        [JsonPropertyName("is_adult")]
        public bool IsAdult { get; init; }

        [JsonPropertyName("is_locked")]
        public bool IsLocked { get; init; }

        [JsonPropertyName("is_audio")]
        public bool IsAudio { get; init; }

        [JsonPropertyName("is_paid")]
        public bool IsPaid { get; init; }

        [JsonPropertyName("is_livestream")]
        public bool IsLivestream { get; init; }
    }

    private sealed class RutubePlayOptions
    {
        [JsonPropertyName("video_balancer")]
        public RutubeVideoBalancer? VideoBalancer { get; init; }
    }

    private sealed class RutubeVideoBalancer
    {
        [JsonPropertyName("m3u8")]
        public string? M3u8 { get; init; }
    }

    [GeneratedRegex("^[0-9a-f]{32}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex RutubeIdRegex();

    [GeneratedRegex("(?:19|20)[0-9]{2}", RegexOptions.CultureInvariant)]
    private static partial Regex YearRegex();
}
