using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers.Providers;

/// <summary>
/// Animevost (animevost.org) — RU-dub anime, ported from the lampac Animevost module over the
/// plain web path (its optional rch proxy layer is not reproduced). DLE search, the season
/// playlist from the page's <c>var data</c> block, and direct 720p/480p mp4 links from the
/// frame5.php player page.
/// </summary>
public sealed class AnimevostProvider(HttpClient http, IMemoryCache? cache = null)
    : ProviderBase(http, cache), IOnlineProvider
{
    private const string Host = "https://animevost.org";

    public string Id => "animevost";
    public string Name => "Animevost";
    public ProviderDescriptor Descriptor => new(Id, Name, "anime", Slow: true);

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        var title = query.Title ?? query.OriginalTitle;
        if (string.IsNullOrWhiteSpace(title))
            return Task.FromResult<IReadOnlyList<SourceItem>>([]);

        return CachedAsync<IReadOnlyList<SourceItem>>(
            $"animevost:search:{title}",
            TimeSpan.FromHours(4),
            async () =>
            {
                using var request = new HttpRequestMessage(
                    HttpMethod.Post,
                    $"{Host}/index.php?do=search")
                {
                    Content = new FormUrlEncodedContent(new Dictionary<string, string>
                    {
                        ["do"] = "search",
                        ["subaction"] = "search",
                        ["search_start"] = "0",
                        ["full_search"] = "0",
                        ["result_from"] = "1",
                        ["story"] = title,
                    }),
                };
                var html = await GetStringAsync(request, cancellationToken);
                var mediaType = string.Equals(query.Type, "movie", StringComparison.OrdinalIgnoreCase) ? "movie" : "tv";
                var items = new List<SourceItem>();
                foreach (var row in Regex.Split(html, "class=\"shortstory\"").Skip(1))
                {
                    var link = Regex.Match(row, "<a href=\"(https?://[^\"]+\\.html)\">([^<]+)</a>");
                    if (!link.Success)
                        continue;
                    var yearMatch = Regex.Match(row, "<strong>Год выхода: ?</strong>([0-9]{4})</p>");
                    var image = Regex.Match(row, " src=\"(/uploads/[^\"]+)\"");
                    var season = SeasonFromTitle(link.Groups[2].Value);
                    items.Add(new SourceItem(
                        Id,
                        Name,
                        $"{season}|{link.Groups[1].Value}",
                        link.Groups[2].Value,
                        null,
                        yearMatch.Success && int.TryParse(yearMatch.Groups[1].Value, out var year) ? year : null,
                        image.Success ? Host + image.Groups[1].Value : null,
                        string.Empty,
                        null,
                        mediaType));
                }
                return (IReadOnlyList<SourceItem>)items;
            });
    }

    public async Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken)
    {
        // The season number rides in the SourceId (lampac's `s` param), separated by '|'.
        var parts = selection.SourceId.Split('|', 2);
        var season = parts.Length == 2 && int.TryParse(parts[0], out var parsedSeason) && parsedSeason > 0
            ? parsedSeason
            : 1;
        var html = await GetStringAsync(Get(parts[^1]), cancellationToken);
        var data = Regex.Match(html, "var data = ([^\\n\\r]+)");
        if (!data.Success)
            return new EpisodesResult([], 0);

        var episodes = new List<EpisodeItem>();
        var match = Regex.Match(data.Groups[1].Value, "\"([^\"]+)\":\"([0-9]+)\",");
        while (match.Success)
        {
            var name = match.Groups[1].Value;
            var id = match.Groups[2].Value;
            var number = Regex.Match(name, "^([0-9]+)");
            episodes.Add(new EpisodeItem(
                $"{Id}:{id}",
                season,
                number.Success && double.TryParse(number.Groups[1].Value, out var parsed) ? parsed : episodes.Count + 1,
                name,
                null,
                null,
                [],
                LocatorCodec.Encode(new AnimevostLocator(id))));
            match = match.NextMatch();
        }
        return new EpisodesResult(episodes, episodes.Select(item => item.Season).DefaultIfEmpty(1).Max());
    }

    public async Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken)
    {
        var locator = string.IsNullOrWhiteSpace(selection.Locator)
            ? throw new ProviderException("Animevost playback locator is missing.")
            : LocatorCodec.Decode<AnimevostLocator>(selection.Locator);
        var iframe = await GetStringAsync(Get($"{Host}/frame5.php?play={locator.Id}&old=1"), cancellationToken);

        var qualities = new (string Quality, Regex Pattern)[]
        {
            ("720p", new Regex("download=\"invoice\"[^>]+href=\"(https?://[^\"]+)\">720p")),
            ("480p", new Regex("download=\"invoice\"[^>]+href=\"(https?://[^\"]+)\">480p")),
        };
        foreach (var (quality, pattern) in qualities)
        {
            var link = pattern.Match(iframe);
            if (link.Success)
                return new ResolvedPlayback(link.Groups[1].Value, quality, null);
        }
        throw new ProviderException("Animevost did not return a playable stream.");
    }

    private static int SeasonFromTitle(string title)
    {
        var match = Regex.Match(title, "([0-9 ]+) ?nd ", RegexOptions.IgnoreCase);
        if (!match.Success)
            match = Regex.Match(title, "Season ([0-9]+)", RegexOptions.IgnoreCase);
        return match.Success && int.TryParse(match.Groups[1].Value.Trim(), out var season) && season > 0 ? season : 1;
    }

    private sealed record AnimevostLocator(string Id);
}
