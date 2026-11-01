using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers.Providers;

public sealed partial class VeoVeoProvider(HttpClient http, IMemoryCache? cache = null)
    : ProviderBase(http, cache), IOnlineProvider
{
    private const string Host = "https://api.rstprgapipt.com";

    public string Id => "veoveo";
    public string Name => "VeoVeo";
    public ProviderDescriptor Descriptor => new(Id, Name, "movies");

    public async Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        var sourceId = await ResolveSourceIdAsync(query, cancellationToken);
        if (sourceId is null)
            return [];
        return [new SourceItem(
            Id,
            Name,
            sourceId,
            query.Title ?? query.OriginalTitle ?? Name,
            query.OriginalTitle,
            query.Year,
            null,
            "1080p",
            null,
            query.Type == "movie" ? "movie" : "tv")];
    }

    public async Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken)
    {
        var catalog = await GetCatalogAsync(selection.SourceId, cancellationToken);
        if (catalog.FirstOrDefault()?.Season?.Order == 0)
            return new EpisodesResult([], 0);
        var episodes = catalog
            .Where(item => item.Season is not null && item.Order > 0)
            .OrderBy(item => item.Season!.Order)
            .ThenBy(item => item.Order)
            .Select(item =>
            {
                var audios = (item.EpisodeVariants ?? [])
                    .Where(variant => !string.IsNullOrWhiteSpace(variant.Filepath))
                    .Select((variant, index) => new AudioItem(
                        $"{Id}:{item.Season!.Order}:{item.Order}:{index}",
                        variant.Title ?? $"Вариант {index + 1}",
                        LocatorCodec.Encode(new VeoVeoLocator(variant.Filepath!, variant.Title))))
                    .ToArray();
                if (audios.Length == 0)
                    return null;
                return new EpisodeItem(
                    Id: $"{Id}:{selection.SourceId}:{item.Season!.Order}:{item.Order}",
                    Season: item.Season.Order,
                    Number: item.Order,
                    Title: item.Title ?? $"{item.Order} серия",
                    Voice: audios[0].Name,
                    Url: null,
                    Audios: audios,
                    Locator: audios[0].Locator);
            })
            .Where(item => item is not null)
            .Cast<EpisodeItem>()
            .ToArray();
        return new EpisodesResult(episodes, episodes.Length == 0 ? 0 : episodes.Max(item => item.Season));
    }

    public async Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken)
    {
        VeoVeoLocator locator;
        if (!string.IsNullOrWhiteSpace(selection.Locator))
        {
            locator = LocatorCodec.Decode<VeoVeoLocator>(selection.Locator);
        }
        else
        {
            var catalog = await GetCatalogAsync(selection.SourceId, cancellationToken);
            var variant = catalog.SelectMany(item => item.EpisodeVariants ?? [])
                .FirstOrDefault(item => !string.IsNullOrWhiteSpace(item.Filepath))
                ?? throw new ProviderException("VeoVeo did not return a playable stream.");
            locator = new VeoVeoLocator(variant.Filepath!, variant.Title);
        }

        var url = ProviderParsing.AbsoluteHttps(locator.Url);
        if (url.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
        {
            var parsed = await GetJsonAsync<VeoVeoParsed>(Get(url, Host), cancellationToken);
            url = parsed.Sources?.Select(item => item.Link).FirstOrDefault(item => !string.IsNullOrWhiteSpace(item))
                ?? throw new ProviderException("VeoVeo parsed playlist is empty.");
            url = ProviderParsing.AbsoluteHttps(url);
        }
        return new ResolvedPlayback(url, QualityFrom(locator.Title), locator.Title);
    }

    private async Task<string?> ResolveSourceIdAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        var key = query.KinopoiskId is > 0
            ? $"kp={query.KinopoiskId.Value}"
            : !string.IsNullOrWhiteSpace(query.ImdbId)
                ? $"imdb={Uri.EscapeDataString(query.ImdbId)}"
                : null;
        if (key is null)
            return null;
        return await CachedAsync($"veoveo:source:{key}", TimeSpan.FromHours(4), async () =>
        {
            var html = await GetStringAsync(Get($"{Host}/balancer-api/iframe?{key}", Host), cancellationToken);
            var match = MovieIdRegex().Match(html);
            return match.Success ? match.Groups[1].Value : null;
        });
    }

    private Task<List<VeoVeoCatalogItem>> GetCatalogAsync(string sourceId, CancellationToken cancellationToken)
    {
        if (!long.TryParse(sourceId, out var id) || id <= 0)
            throw new ProviderException("VeoVeo source id is invalid.");
        return CachedAsync($"veoveo:catalog:{id}", TimeSpan.FromMinutes(20), () =>
            GetJsonAsync<List<VeoVeoCatalogItem>>(
                Get($"{Host}/balancer-api/proxy/playlists/catalog-api/episodes?content-id={id}", Host),
                cancellationToken));
    }

    private static string QualityFrom(string? value)
    {
        var match = QualityRegex().Match(value ?? string.Empty);
        return match.Success ? $"{match.Groups[1].Value}p" : "1080p";
    }

    private sealed record VeoVeoLocator(string Url, string? Title);
    private sealed class VeoVeoCatalogItem
    {
        public int Order { get; init; }
        public string? Title { get; init; }
        public VeoVeoSeason? Season { get; init; }
        public List<VeoVeoVariant>? EpisodeVariants { get; init; }
    }
    private sealed class VeoVeoSeason { public int Order { get; init; } }
    private sealed class VeoVeoVariant
    {
        public string? Title { get; init; }
        public string? Filepath { get; init; }
    }
    private sealed class VeoVeoParsed { public List<VeoVeoParsedSource>? Sources { get; init; } }
    private sealed class VeoVeoParsedSource { public string? Link { get; init; } }

    [GeneratedRegex("window\\.MOVIE_ID\\s*=\\s*([0-9]+)", RegexOptions.IgnoreCase)]
    private static partial Regex MovieIdRegex();
    [GeneratedRegex("([0-9]{3,4})p", RegexOptions.IgnoreCase)]
    private static partial Regex QualityRegex();
}
