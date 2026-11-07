using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers.Providers;

/// <summary>
/// AnimeLib (hapi.hentaicdn.org) — adult anime (18+), ported from the lampac AnimeLib
/// module (APK-style access). Free: search by RU/EN title, episodes under an anime slug with
/// per-team (Animelib player) streams; video servers come from the constants endpoint and
/// stream URLs are videoServer + quality href. Marked Adult in the descriptor so the host
/// can filter/label 18+ sources. Requires account-level access off; an empty bearer mirrors
/// lampac's site-proxy path.
/// </summary>
public sealed class AnimeLibProvider(HttpClient http, IMemoryCache? cache = null)
    : ProviderBase(http, cache), IOnlineProvider
{
    private const string Host = "https://hapi.hentaicdn.org";

    public string Id => "animelib";
    public string Name => "AnimeLib";
    public ProviderDescriptor Descriptor => new(Id, Name, "anime", "free", null, Adult: true);

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        var title = query.Title ?? query.OriginalTitle;
        if (string.IsNullOrWhiteSpace(title))
            return Task.FromResult<IReadOnlyList<SourceItem>>([]);

        return CachedAsync<IReadOnlyList<SourceItem>>(
            $"animelib:search:{title}:{query.OriginalTitle}",
            TimeSpan.FromHours(4),
            async () =>
            {
                var items = new List<SourceItem>();
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var searchTerm in new[] { title, query.OriginalTitle }.Where(term => !string.IsNullOrWhiteSpace(term)).Distinct())
                {
                    using var root = await GetJsonAsync<JsonDocument>(
                        ApiGet($"{Host}/api/anime?fields[]=rate_avg&fields[]=rate&fields[]=releaseDate&q={Uri.EscapeDataString(searchTerm!)}"),
                        cancellationToken);
                    if (!root.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
                        continue;
                    foreach (var item in data.EnumerateArray())
                    {
                        var slug = String(item, "slug_url");
                        if (string.IsNullOrWhiteSpace(slug) || !seen.Add(slug))
                            continue;
                        var releaseDate = String(item, "releaseDate");
                        items.Add(new SourceItem(
                            Id,
                            Name,
                            slug,
                            JoinNames(String(item, "rus_name"), String(item, "eng_name")),
                            String(item, "eng_name"),
                            int.TryParse(releaseDate?.Split('-')[0], out var year) && year > 0 ? year : null,
                            NestedString(item, "cover", "default"),
                            string.Empty,
                            null,
                            "tv"));
                    }
                }
                return (IReadOnlyList<SourceItem>)items;
            });
    }

    public async Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken)
    {
        var episodes = await LoadEpisodesAsync(selection.SourceId, cancellationToken);
        if (episodes.Count == 0)
            return new EpisodesResult([], 0);

        var players = await LoadPlayersAsync(episodes[0].Id, cancellationToken);
        var audios = players
            .Select((player, index) => new AudioItem(
                $"{Id}:{selection.SourceId}:{index}",
                player.Team,
                LocatorCodec.Encode(new AnimeLibLocator(episodes[0].Id, player.Team))))
            .ToArray();

        var items = episodes
            .Select((episode, index) =>
            {
                var number = double.TryParse(
                    episode.Number, System.Globalization.CultureInfo.InvariantCulture, out var parsed)
                    ? parsed
                    : index + 1;
                return new EpisodeItem(
                    $"{Id}:{selection.SourceId}:{episode.Id}",
                    int.TryParse(episode.Season, out var season) && season > 0 ? season : 1,
                    number,
                    string.IsNullOrWhiteSpace(episode.Name) ? $"{number:g} серия" : episode.Name,
                    audios.FirstOrDefault()?.Name,
                    null,
                    audios,
                    audios.FirstOrDefault()?.Locator);
            })
            .ToArray();
        return new EpisodesResult(items, items.Select(item => item.Season).DefaultIfEmpty(1).Max());
    }

    public async Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken)
    {
        var locator = string.IsNullOrWhiteSpace(selection.Locator)
            ? throw new ProviderException("AnimeLib playback locator is missing.")
            : LocatorCodec.Decode<AnimeLibLocator>(selection.Locator);
        var players = await LoadPlayersAsync(locator.EpisodeId, cancellationToken);
        var servers = await LoadVideoServersAsync(cancellationToken);

        foreach (var player in players)
        {
            if (!string.Equals(player.Team, locator.Voice, StringComparison.Ordinal))
                continue;
            var stream = player.Qualities
                .Where(quality => !string.IsNullOrWhiteSpace(quality.Href))
                .Where(quality => servers.TryGetValue(player.VideoDomain ?? string.Empty, out _))
                .OrderByDescending(quality => quality.Quality)
                .Select(quality => (
                    Url: $"{servers[player.VideoDomain ?? string.Empty]}/{quality.Href!.TrimStart('/')}",
                    Quality: quality.Quality))
                .FirstOrDefault();
            if (stream.Url is not null)
                return new ResolvedPlayback(stream.Url, $"{stream.Quality}p", player.Team);
        }

        // Fall back to any team when the requested voice carried no streams.
        var fallback = players
            .Where(player => servers.TryGetValue(player.VideoDomain ?? string.Empty, out _))
            .SelectMany(player => player.Qualities
                .Where(quality => !string.IsNullOrWhiteSpace(quality.Href))
                .Select(quality => (
                    Url: $"{servers[player.VideoDomain ?? string.Empty]}/{quality.Href!.TrimStart('/')}",
                    Quality: quality.Quality,
                    Team: player.Team)))
            .OrderByDescending(stream => stream.Quality)
            .FirstOrDefault();
        if (fallback.Url is null)
            throw new ProviderException("AnimeLib did not return a playable stream.");
        return new ResolvedPlayback(fallback.Url, $"{fallback.Quality}p", fallback.Team);
    }

    private Task<IReadOnlyList<AnimeLibEpisode>> LoadEpisodesAsync(string slug, CancellationToken cancellationToken) =>
        CachedAsync<IReadOnlyList<AnimeLibEpisode>>(
            $"animelib:episodes:{slug}",
            TimeSpan.FromHours(1),
            async () =>
            {
                using var root = await GetJsonAsync<JsonDocument>(
                    ApiGet($"{Host}/api/episodes?anime_id={Uri.EscapeDataString(slug)}"), cancellationToken);
                if (!root.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
                    return [];
                return data.EnumerateArray()
                    .Select(item => new AnimeLibEpisode(
                        Int(item, "id"),
                        String(item, "name") ?? string.Empty,
                        String(item, "number") ?? string.Empty,
                        String(item, "season") ?? "1"))
                    .Where(episode => episode.Id > 0)
                    .ToArray();
            });

    private Task<IReadOnlyList<AnimeLibPlayer>> LoadPlayersAsync(int episodeId, CancellationToken cancellationToken) =>
        CachedAsync<IReadOnlyList<AnimeLibPlayer>>(
            $"animelib:players:{episodeId}",
            TimeSpan.FromMinutes(30),
            async () =>
            {
                using var root = await GetJsonAsync<JsonDocument>(
                    ApiGet($"{Host}/api/episodes/{episodeId}"), cancellationToken);
                if (!root.RootElement.TryGetProperty("data", out var data) ||
                    !data.TryGetProperty("players", out var players) || players.ValueKind != JsonValueKind.Array)
                    return [];
                return players.EnumerateArray()
                    .Where(player => string.Equals(String(player, "player"), "Animelib", StringComparison.Ordinal))
                    .Select(player => new AnimeLibPlayer(
                        NestedString(player, "team", "name") ?? "Animelib",
                        String(player, "video_domain"),
                        player.TryGetProperty("video", out var video) &&
                        video.TryGetProperty("quality", out var qualities) && qualities.ValueKind == JsonValueKind.Array
                            ? qualities.EnumerateArray()
                                .Select(quality => new AnimeLibQuality(
                                    Int(quality, "quality"),
                                    String(quality, "href")))
                                .ToArray()
                            : []))
                    .ToArray();
            });

    private Task<IReadOnlyDictionary<string, string>> LoadVideoServersAsync(CancellationToken cancellationToken) =>
        CachedAsync(
            "animelib:videoServers",
            TimeSpan.FromMinutes(5),
            async () =>
            {
                var request = ApiGet($"{Host}/api/constants?fields[]=videoServers");
                using var root = await GetJsonAsync<JsonDocument>(request, cancellationToken);
                var servers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                if (root.RootElement.TryGetProperty("data", out var data) &&
                    data.TryGetProperty("videoServers", out var list) && list.ValueKind == JsonValueKind.Array)
                {
                    foreach (var server in list.EnumerateArray())
                    {
                        var id = String(server, "id");
                        var url = String(server, "url");
                        if (!string.IsNullOrWhiteSpace(id) && Uri.TryCreate(url, UriKind.Absolute, out var uri) &&
                            uri.Scheme is "http" or "https")
                            servers[id] = url.TrimEnd('/');
                    }
                }
                return (IReadOnlyDictionary<string, string>)servers;
            });

    // The API rejects bare requests (403): the app sends the site-id header plus the
    // anilib.me Origin/Referer (lampac's AnimeLib module) — mirror that on every call.
    private static HttpRequestMessage ApiGet(string url)
    {
        var request = Get(url);
        request.Headers.TryAddWithoutValidation("site-id", "5");
        request.Headers.TryAddWithoutValidation("Origin", "https://anilib.me");
        request.Headers.TryAddWithoutValidation("Referer", "https://anilib.me/");
        return request;
    }

    private static string JoinNames(string? rus, string? eng) =>
        !string.IsNullOrWhiteSpace(rus) && !string.IsNullOrWhiteSpace(eng) && rus != eng
            ? $"{rus} / {eng}"
            : rus ?? eng ?? "AnimeLib";

    private static string? String(JsonElement element, string name) =>
        element.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static string? NestedString(JsonElement element, string outer, string inner) =>
        element.TryGetProperty(outer, out var nested) ? String(nested, inner) : null;

    private static int Int(JsonElement element, string name) =>
        element.TryGetProperty(name, out var property) && property.TryGetInt32(out var value) ? value : 0;

    private sealed record AnimeLibEpisode(int Id, string Name, string Number, string Season);

    private sealed record AnimeLibPlayer(string Team, string? VideoDomain, AnimeLibQuality[] Qualities);

    private sealed record AnimeLibQuality(int Quality, string? Href);

    private sealed record AnimeLibLocator(int EpisodeId, string? Voice);
}
