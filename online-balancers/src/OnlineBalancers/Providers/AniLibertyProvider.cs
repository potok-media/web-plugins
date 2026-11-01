using Microsoft.Extensions.Caching.Memory;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace OnlineBalancers.Providers;

public sealed partial class AniLibertyProvider(HttpClient http, IMemoryCache? cache = null) : ProviderBase(http, cache), IOnlineProvider
{
    private const string Host = "https://api.anilibria.app";

    public string Id => "aniliberty";
    public string Name => "AniLiberty";

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        var title = query.Title ?? query.OriginalTitle;
        if (string.IsNullOrWhiteSpace(title))
            return Task.FromResult<IReadOnlyList<SourceItem>>([]);

        return CachedAsync<IReadOnlyList<SourceItem>>(
            $"aniliberty:search:{title}",
            TimeSpan.FromHours(4),
            async () =>
            {
                var items = await GetJsonAsync<List<SearchModel>>(
                    Get($"{Host}/api/v1/app/search/releases?query={Uri.EscapeDataString(title)}"),
                    cancellationToken);
                var normalized = ProviderParsing.NormalizeTitle(title);
                var matches = items
                    .Where(item => Matches(item.Name?.Main, item.Name?.English, normalized))
                    .Select(item => new SourceItem(
                        Id,
                        Name,
                        item.Id.ToString(),
                        JoinTitles(item.Name?.Main, item.Name?.English),
                        item.Name?.English,
                        item.Year,
                        string.IsNullOrWhiteSpace(item.Poster?.Src) ? null : new Uri(new Uri(Host), item.Poster.Src).ToString(),
                        "1080p",
                        null,
                        "tv"))
                    .ToArray();

                if (matches.Length > 0)
                    return matches;

                return items.Select(item => new SourceItem(
                    Id,
                    Name,
                    item.Id.ToString(),
                    JoinTitles(item.Name?.Main, item.Name?.English),
                    item.Name?.English,
                    item.Year,
                    string.IsNullOrWhiteSpace(item.Poster?.Src) ? null : new Uri(new Uri(Host), item.Poster.Src).ToString(),
                    "1080p",
                    null,
                    "tv")).ToArray();
            });
    }

    public async Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken)
    {
        var release = await GetReleaseAsync(selection.SourceId, cancellationToken);
        var season = GetSeason(release);
        var episodes = release.Episodes?.Select((episode, index) =>
        {
            var number = ProviderParsing.EpisodeNumber(episode.Ordinal, index + 1);
            return new EpisodeItem(
                Id: $"{Id}:{selection.SourceId}:{episode.Ordinal ?? number.ToString()}",
                Season: season,
                Number: number,
                Title: string.IsNullOrWhiteSpace(episode.Name) ? $"{number:g} серия" : episode.Name,
                Voice: null,
                Url: null,
                Audios: [],
                Locator: LocatorCodec.Encode(new AniLibertyLocator(episode.Ordinal ?? number.ToString())));
        }).ToArray() ?? [];

        return new EpisodesResult(episodes, Math.Max(1, season));
    }

    public async Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken)
    {
        var release = await GetReleaseAsync(selection.SourceId, cancellationToken);
        var locator = string.IsNullOrWhiteSpace(selection.Locator)
            ? null
            : LocatorCodec.Decode<AniLibertyLocator>(selection.Locator);
        var requested = locator?.Ordinal;
        var episode = release.Episodes?.FirstOrDefault(item => requested is not null && item.Ordinal == requested)
            ?? release.Episodes?.FirstOrDefault(item =>
                Math.Abs(ProviderParsing.EpisodeNumber(item.Ordinal, -1) - (selection.Episode ?? -2)) < 0.0001)
            ?? throw new ProviderException("AniLiberty episode was not found.");

        var stream = new[]
        {
            (Quality: "1080p", Url: episode.Hls1080),
            (Quality: "720p", Url: episode.Hls720),
            (Quality: "480p", Url: episode.Hls480),
        }.FirstOrDefault(item => !string.IsNullOrWhiteSpace(item.Url));

        if (string.IsNullOrWhiteSpace(stream.Url))
            throw new ProviderException("AniLiberty did not return a playable stream.");

        return new ResolvedPlayback(ProviderParsing.AbsoluteHttps(stream.Url), stream.Quality, null);
    }

    private Task<ReleaseModel> GetReleaseAsync(string sourceId, CancellationToken cancellationToken)
    {
        if (!int.TryParse(sourceId, out _))
            throw new ProviderException("AniLiberty release id is invalid.");

        return CachedAsync(
            $"aniliberty:release:{sourceId}",
            TimeSpan.FromMinutes(20),
            () => GetJsonAsync<ReleaseModel>(Get($"{Host}/api/v1/anime/releases/{sourceId}"), cancellationToken));
    }

    private static bool Matches(string? main, string? english, string normalized) =>
        ProviderParsing.NormalizeTitle(main).Contains(normalized, StringComparison.Ordinal) ||
        ProviderParsing.NormalizeTitle(english).Contains(normalized, StringComparison.Ordinal) ||
        normalized.Contains(ProviderParsing.NormalizeTitle(main), StringComparison.Ordinal) ||
        normalized.Contains(ProviderParsing.NormalizeTitle(english), StringComparison.Ordinal);

    private static string JoinTitles(string? main, string? english)
    {
        if (string.IsNullOrWhiteSpace(main))
            return english ?? "AniLiberty";
        if (string.IsNullOrWhiteSpace(english) || string.Equals(main, english, StringComparison.OrdinalIgnoreCase))
            return main;
        return $"{main} / {english}";
    }

    private static int GetSeason(ReleaseModel release)
    {
        var aliasMatch = AliasSeasonRegex().Match(release.Alias ?? string.Empty);
        if (aliasMatch.Success)
            return int.Parse(aliasMatch.Groups[1].Success ? aliasMatch.Groups[1].Value : aliasMatch.Groups[2].Value);

        foreach (var name in new[] { release.Name?.Main, release.Name?.English })
        {
            var titleMatch = TitleSeasonRegex().Match(name ?? string.Empty);
            if (titleMatch.Success)
                return int.Parse(titleMatch.Groups.Cast<Group>().Skip(1).First(group => group.Success).Value);
        }

        var numeric = BareNumberRegex().Match(release.Name?.Main ?? string.Empty);
        var roman = RomanNumberRegex().Match(release.Name?.English ?? string.Empty);
        if (numeric.Success && roman.Success)
        {
            var romans = new[] { "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X" };
            var romanSeason = Array.IndexOf(romans, roman.Groups[1].Value) + 1;
            if (int.TryParse(numeric.Groups[1].Value, out var numericSeason) && numericSeason == romanSeason)
                return numericSeason;
        }

        return 1;
    }

    [GeneratedRegex(@"(?:^|-)(?:season-)?([0-9]{1,2})(?:st|nd|rd|th)(?:-|$)|(?:^|-)season-([0-9]{1,2})(?:-|$)", RegexOptions.IgnoreCase)]
    private static partial Regex AliasSeasonRegex();

    [GeneratedRegex(@"\b(?:сезон|season)\s*([0-9]{1,2})\b|\b([0-9]{1,2})\s*(?:сезон|season)\b", RegexOptions.IgnoreCase)]
    private static partial Regex TitleSeasonRegex();

    [GeneratedRegex(@"\s([0-9]{1,2})(?=\s*(?::|$))")]
    private static partial Regex BareNumberRegex();

    [GeneratedRegex(@"\b(II|III|IV|V|VI|VII|VIII|IX|X)\b(?=\s*(?::|$))")]
    private static partial Regex RomanNumberRegex();

    private sealed record AniLibertyLocator(string Ordinal);

    private sealed class NameModel
    {
        public string? Main { get; init; }
        public string? English { get; init; }
    }

    private sealed class PosterModel
    {
        public string? Src { get; init; }
    }

    private sealed class SearchModel
    {
        public int Id { get; init; }
        public int Year { get; init; }
        public NameModel? Name { get; init; }
        public PosterModel? Poster { get; init; }
    }

    private sealed class EpisodeModel
    {
        [JsonPropertyName("ordinal")]
        public JsonElement OrdinalValue { get; init; }
        [JsonIgnore]
        public string? Ordinal => OrdinalValue.ValueKind switch
        {
            JsonValueKind.String => OrdinalValue.GetString(),
            JsonValueKind.Number => OrdinalValue.GetRawText(),
            _ => null,
        };
        public string? Name { get; init; }
        public string? Hls_1080 { get; init; }
        public string? Hls_720 { get; init; }
        public string? Hls_480 { get; init; }
        public string? Hls1080 => Hls_1080;
        public string? Hls720 => Hls_720;
        public string? Hls480 => Hls_480;
    }

    private sealed class ReleaseModel
    {
        public string? Alias { get; init; }
        public NameModel? Name { get; init; }
        public EpisodeModel[]? Episodes { get; init; }
    }
}
