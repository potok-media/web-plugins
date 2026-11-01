using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers.Providers;

public sealed class KodikProvider(HttpClient http, IMemoryCache? cache = null) : ProviderBase(http, cache), IOnlineProvider
{
    private const string ApiHost = "https://kodik-api.com";
    private const string PlayerHost = "https://kodikplayer.com";
    private const string ApiToken = "41dd95f84c21719b09d6c71182237a25";
    private const string Referer = "https://anilib.me/";
    private readonly KodikPlayerResolver _playerResolver = new(http);

    public string Id => "kodik";
    public string Name => "Kodik";

    public async Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        var results = await GetResultsAsync(query, cancellationToken);
        return results.Select(result => new SourceItem(
            Id,
            Name,
            result.Id ?? throw new ProviderException("Kodik result has no id."),
            result.Title ?? result.TitleOrig ?? "Kodik",
            result.TitleOrig,
            result.Year,
            result.MaterialData?.AnimePosterUrl ?? result.MaterialData?.DramaPosterUrl ?? result.MaterialData?.PosterUrl,
            "720p",
            result.Translation?.Title ?? "Оригинал",
            IsMovie(result.Type) ? "movie" : "tv")).ToArray();
    }

    public async Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken)
    {
        var selected = await GetSelectedAsync(selection.SourceId, selection.Query, cancellationToken);
        if (IsMovie(selected.Type))
            return new EpisodesResult([], 0);

        var episodes = new List<EpisodeItem>();
        if (selected.Seasons is not null)
        {
            foreach (var seasonEntry in selected.Seasons.OrderBy(entry => ParseInt(entry.Key, int.MaxValue)))
            {
                var season = ParseInt(seasonEntry.Key, 1);
                if (seasonEntry.Value.Episodes is null)
                    continue;
                foreach (var episodeEntry in seasonEntry.Value.Episodes.OrderBy(entry => ProviderParsing.EpisodeNumber(entry.Key, int.MaxValue)))
                {
                    var number = ProviderParsing.EpisodeNumber(episodeEntry.Key, episodes.Count + 1);
                    episodes.Add(new EpisodeItem(
                        Id: $"{Id}:{selection.SourceId}:{season}:{episodeEntry.Key}",
                        Season: season,
                        Number: number,
                        Title: $"{number:g} серия",
                        Voice: selected.Translation?.Title ?? "Оригинал",
                        Url: null,
                        Audios: [],
                        Locator: LocatorCodec.Encode(new KodikLocator(season, number))));
                }
            }
        }

        var seasonsCount = episodes.Count == 0 ? Math.Max(1, selected.LastSeason) : episodes.Max(item => item.Season);
        return new EpisodesResult(episodes, seasonsCount);
    }

    public async Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken)
    {
        var selected = await GetSelectedAsync(selection.SourceId, selection.Query, cancellationToken);
        string? playerLink;
        if (IsMovie(selected.Type))
        {
            playerLink = selected.Link;
        }
        else
        {
            var locator = string.IsNullOrWhiteSpace(selection.Locator)
                ? new KodikLocator(selection.Season ?? 1, selection.Episode ?? 1)
                : LocatorCodec.Decode<KodikLocator>(selection.Locator);
            var seasonKey = locator.Season.ToString(System.Globalization.CultureInfo.InvariantCulture);
            playerLink = selected.Seasons is not null && selected.Seasons.TryGetValue(seasonKey, out var season)
                ? season.Episodes?.FirstOrDefault(entry =>
                    Math.Abs(ProviderParsing.EpisodeNumber(entry.Key, -1) - locator.Episode) < 0.0001).Value
                : null;
        }

        if (string.IsNullOrWhiteSpace(playerLink))
            throw new ProviderException("Kodik did not return a player link.");

        var streams = await _playerResolver.ResolveAsync(playerLink, Referer, cancellationToken);
        var best = streams.OrderByDescending(item => item.Height).FirstOrDefault()
            ?? throw new ProviderException("Kodik did not return a playable stream.");
        return new ResolvedPlayback(
            best.Url,
            $"{best.Height}p",
            selected.Translation?.Title ?? selection.Voice,
            new Dictionary<string, string> { ["Referer"] = Referer });
    }

    private Task<IReadOnlyList<KodikResult>> GetResultsAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        var cacheKey = $"kodik:search:{query.ImdbId}:{query.KinopoiskId}:{query.OriginalTitle}:{query.Title}";
        return CachedAsync<IReadOnlyList<KodikResult>>(cacheKey, TimeSpan.FromMinutes(40), async () =>
        {
            var results = new List<KodikResult>();
            if (!string.IsNullOrWhiteSpace(query.ImdbId))
                await AddResultsAsync(results, "imdb_id", query.ImdbId, cancellationToken);
            if (query.KinopoiskId is > 0)
                await AddResultsAsync(results, "kinopoisk_id", query.KinopoiskId.Value.ToString(), cancellationToken);

            if (results.Count == 0)
            {
                var title = query.OriginalTitle ?? query.Title;
                if (!string.IsNullOrWhiteSpace(title))
                    await AddResultsAsync(results, "title", title, cancellationToken);
            }

            return results;
        });
    }

    private async Task AddResultsAsync(List<KodikResult> results, string key, string value, CancellationToken cancellationToken)
    {
        var url = $"{ApiHost}/search?token={ApiToken}&limit=100&with_episodes=true&with_material_data=true&{key}={Uri.EscapeDataString(value)}";
        var root = await GetJsonAsync<KodikRoot>(Get(url, Referer), cancellationToken);
        foreach (var result in root.Results ?? [])
        {
            if (!string.IsNullOrWhiteSpace(result.Id) && results.All(existing => existing.Id != result.Id))
                results.Add(result);
        }
    }

    private async Task<KodikResult> GetSelectedAsync(string sourceId, MediaQuery query, CancellationToken cancellationToken)
    {
        var results = await GetResultsAsync(query, cancellationToken);
        return results.FirstOrDefault(item => item.Id == sourceId)
            ?? throw new ProviderException("Kodik source was not found.");
    }

    private static bool IsMovie(string? type) => type is
        "foreign-movie" or "soviet-cartoon" or "foreign-cartoon" or "russian-cartoon" or "anime" or "russian-movie";

    private static int ParseInt(string value, int fallback) => int.TryParse(value, out var result) ? result : fallback;

    private sealed record KodikLocator(int Season, double Episode);

    private sealed class KodikRoot
    {
        public List<KodikResult>? Results { get; init; }
    }

    private sealed class KodikResult
    {
        public string? Id { get; init; }
        public string? Title { get; init; }
        public string? Title_Orig { get; init; }
        public string? TitleOrig => Title_Orig;
        public string? Type { get; init; }
        public int? Year { get; init; }
        public string? Link { get; init; }
        public TranslationModel? Translation { get; init; }
        public int Last_Season { get; init; }
        public int LastSeason => Last_Season;
        public Dictionary<string, SeasonModel>? Seasons { get; init; }
        public MaterialDataModel? Material_Data { get; init; }
        public MaterialDataModel? MaterialData => Material_Data;
    }

    private sealed class TranslationModel
    {
        public string? Title { get; init; }
    }

    private sealed class SeasonModel
    {
        public Dictionary<string, string>? Episodes { get; init; }
    }

    private sealed class MaterialDataModel
    {
        public string? Poster_Url { get; init; }
        public string? Drama_Poster_Url { get; init; }
        public string? Anime_Poster_Url { get; init; }
        public string? PosterUrl => Poster_Url;
        public string? DramaPosterUrl => Drama_Poster_Url;
        public string? AnimePosterUrl => Anime_Poster_Url;
    }
}
