using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers.Providers;

/// <summary>
/// Filmix (filmix.my) — RU movies and series via the Filmix v2 app API, ported from the
/// lampac Filmix module. Account-bound: the device flow issues a <c>code</c> that becomes the
/// <c>user_dev_token</c>; every request carries the device-args envelope (a stable random
/// device id per token, as the FX app does). Search is the app search with the api.filmix.tv
/// api-fx fallback; playback extracts the quality ladder from the post's player_links and
/// rewrites plain mp4 links to the Filmix HLS endpoint.
/// </summary>
public sealed class FilmixProvider(HttpClient http, IMemoryCache? cache = null)
    : ProviderBase(http, cache), IOnlineProvider
{
    private const string Host = "https://filmix.my";
    private const string FallbackSearchHost = "https://api.filmix.tv";
    private const string DeviceArgsFormat =
        "app_lang=ru_RU&user_dev_apk=2.2.13&user_dev_id={0}&user_dev_name=Xiaomi+24069PC21G&user_dev_os=12&user_dev_token={1}&user_dev_vendor=Xiaomi";

    // One stable device id per token, like the FX app installation.
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, string> DeviceIds = new();

    public string Id => "filmix";
    public string Name => "Filmix";
    public ProviderDescriptor Descriptor => new(Id, Name, "general", "account", "device-code");

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken) =>
        throw AccountRequired();

    public Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken) =>
        throw AccountRequired();

    public Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken) =>
        throw AccountRequired();

    public Task<IReadOnlyList<SourceItem>> SearchAsync(
        MediaQuery query, ProviderRequestContext context, CancellationToken cancellationToken)
    {
        var token = ReadToken(context);
        var story = query.Title ?? query.OriginalTitle;
        if (string.IsNullOrWhiteSpace(story))
            return Task.FromResult<IReadOnlyList<SourceItem>>([]);

        return CachedAsync<IReadOnlyList<SourceItem>>(
            $"filmix:search:{story}:{query.OriginalTitle}:{query.Year}",
            TimeSpan.FromHours(4),
            async () =>
            {
                var items = await SearchAppAsync(story, token, cancellationToken);
                items ??= await SearchFallbackAsync(story, token, cancellationToken);

                if ((items is null || items.Count == 0) &&
                    !string.IsNullOrWhiteSpace(query.OriginalTitle) &&
                    !string.Equals(story, query.OriginalTitle, StringComparison.OrdinalIgnoreCase))
                {
                    items = await SearchAppAsync(query.OriginalTitle, token, cancellationToken);
                    items ??= await SearchFallbackAsync(query.OriginalTitle, token, cancellationToken);
                }

                var mediaType = string.Equals(query.Type, "movie", StringComparison.OrdinalIgnoreCase) ? "movie" : "tv";
                return (items ?? [])
                    .Select(item => new SourceItem(
                        Id,
                        Name,
                        item.Id.ToString(),
                        JoinTitles(item.Title, item.OriginalTitle ?? item.OriginalName),
                        item.OriginalTitle ?? item.OriginalName,
                        item.Year is > 0 ? item.Year : null,
                        item.Poster,
                        string.Empty,
                        null,
                        mediaType))
                    .ToArray();
            });
    }

    public async Task<EpisodesResult> GetEpisodesAsync(
        SourceSelection selection, ProviderRequestContext context, CancellationToken cancellationToken)
    {
        var token = ReadToken(context);
        if (!int.TryParse(selection.SourceId, out var postId))
            throw new ProviderException("Filmix post id is invalid.");

        var post = await LoadPostAsync(postId, token, cancellationToken)
            ?? throw new ProviderException("Filmix did not return the title's player data.");
        var links = post.PlayerLinks
            ?? throw new ProviderException("Filmix returned no player links.");

        if (links.Movie is { Length: > 0 })
        {
            var audios = links.Movie
                .Select((movie, index) => new AudioItem(
                    $"{Id}:{postId}:movie:{index}",
                    string.IsNullOrWhiteSpace(movie.Translation) ? "Основной поток" : movie.Translation,
                    LocatorCodec.Encode(new FilmixLocator(postId, movie.Translation, movie.Link, movie.Qualities ?? []))))
                .ToArray();
            var fallback = audios.FirstOrDefault() ?? new AudioItem(
                $"{Id}:{postId}:movie:0",
                "Основной поток",
                LocatorCodec.Encode(new FilmixLocator(postId, null, null, [])));
            return new EpisodesResult(
                [new EpisodeItem(
                    $"{Id}:{postId}:movie",
                    1,
                    1,
                    "Фильм",
                    fallback.Name,
                    null,
                    audios.Length == 0 ? [fallback] : audios,
                    fallback.Locator)],
                1);
        }

        if (links.Playlist is not { Count: > 0 })
            return new EpisodesResult([], 0);

        // season -> (episode number -> episode) with per-voice streams.
        var episodes = new Dictionary<(int Season, double Number), (EpisodeItem Template, List<AudioItem> Audios)>();
        foreach (var season in links.Playlist)
        {
            var seasonNumber = (int)(ParseNumber(season.Key) ?? 1);
            foreach (var voice in season.Value)
            {
                var voiceName = string.IsNullOrWhiteSpace(voice.Key) ? "Основной поток" : voice.Key;
                var items = ReadSeasonItems(voice.Value);
                foreach (var (number, movie) in items)
                {
                    var locator = LocatorCodec.Encode(new FilmixLocator(postId, voiceName, movie.Link, movie.Qualities ?? []));
                    if (!episodes.TryGetValue((seasonNumber, number), out var entry))
                    {
                        entry = (
                            new EpisodeItem(
                                $"{Id}:{postId}:{seasonNumber}:{number:g}",
                                seasonNumber,
                                number,
                                $"{number:g} серия",
                                voiceName,
                                null,
                                [],
                                locator),
                            []);
                        episodes.Add((seasonNumber, number), entry);
                    }
                    entry.Audios.Add(new AudioItem($"{entry.Template.Id}:{entry.Audios.Count}", voiceName, locator));
                }
            }
        }

        var ordered = episodes.Values
            .Select(entry => entry.Template with { Audios = entry.Audios })
            .OrderBy(episode => episode.Season)
            .ThenBy(episode => episode.Number)
            .ToArray();
        return new EpisodesResult(ordered, links.Playlist.Count);
    }

    public async Task<ResolvedPlayback> ResolveAsync(
        PlaybackSelection selection, ProviderRequestContext context, CancellationToken cancellationToken)
    {
        ReadToken(context);
        var locator = string.IsNullOrWhiteSpace(selection.Locator)
            ? throw new ProviderException("Filmix playback locator is missing.")
            : LocatorCodec.Decode<FilmixLocator>(selection.Locator);
        if (string.IsNullOrWhiteSpace(locator.Link))
            throw new ProviderException("Filmix did not return a playable stream.");

        var qualities = locator.Qualities.Length > 0
            ? locator.Qualities
            : System.Text.RegularExpressions.Regex.Match(locator.Link, @"_\[\[([0-9,]+)\]\]")
                .Groups[1].Value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(value => int.TryParse(value, out var parsed) ? parsed : 0)
                .Where(quality => quality > 0)
                .ToArray();
        var quality = qualities.Length > 0 ? qualities.Max() : 0;
        if (quality <= 0)
            throw new ProviderException("Filmix did not return a playable quality.");
        var url = locator.Link.Contains("_%s.mp4", StringComparison.Ordinal)
            ? locator.Link.Replace("_%s.mp4", $"_{quality}.mp4", StringComparison.Ordinal)
            : System.Text.RegularExpressions.Regex.Replace(
                locator.Link, @"_\[\[[0-9,]+\]\]\.mp4", $"_{quality}.mp4");

        return new ResolvedPlayback(ToHls(url), $"{quality}p", locator.Translation);
    }

    private async Task<IReadOnlyList<FilmixSearchItem>?> SearchAppAsync(
        string story, string token, CancellationToken cancellationToken)
    {
        var url = $"{Host}/api/v2/search?story={Uri.EscapeDataString(story)}&{DeviceArgs(token)}";
        using var root = await GetJsonAsync<JsonDocument>(Get(url), cancellationToken);
        if (root.RootElement.ValueKind != JsonValueKind.Array || root.RootElement.GetArrayLength() == 0)
            return null;
        return root.RootElement.EnumerateArray()
            .Select(item => new FilmixSearchItem(
                Int(item, "id"),
                String(item, "title"),
                String(item, "original_title"),
                String(item, "original_name"),
                String(item, "poster"),
                Int(item, "year")))
            .Where(item => item.Id > 0)
            .ToArray();
    }

    private async Task<IReadOnlyList<FilmixSearchItem>?> SearchFallbackAsync(
        string story, string token, CancellationToken cancellationToken)
    {
        var url = $"{FallbackSearchHost}/api-fx/list?search={Uri.EscapeDataString(story)}&limit=48";
        using var root = await GetJsonAsync<JsonDocument>(Get(url), cancellationToken);
        if (!root.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
            return null;
        return items.EnumerateArray()
            .Select(item => new FilmixSearchItem(
                Int(item, "id"),
                String(item, "title"),
                String(item, "original_title"),
                String(item, "original_name"),
                null,
                Int(item, "year")))
            .Where(item => item.Id > 0)
            .ToArray();
    }

    private Task<FilmixPost?> LoadPostAsync(int postId, string token, CancellationToken cancellationToken) =>
        CachedAsync(
            $"filmix:post:{postId}",
            TimeSpan.FromMinutes(20),
            async () =>
            {
                var url = $"{Host}/api/v2/post/{postId}?{DeviceArgs(token)}";
                var json = await GetStringAsync(Get(url), cancellationToken);
                // The app emits "playlist":[] for movies; normalize so the doc parses.
                if (json.Contains("\"playlist\":[],", StringComparison.Ordinal))
                    json = json.Replace("\"playlist\":[],", "\"playlist\":null,", StringComparison.Ordinal);
                return JsonSerializer.Deserialize<FilmixPost>(json, SerializerOptions);
            });

    private static string DeviceArgs(string token)
    {
        var deviceId = DeviceIds.GetOrAdd(token, _ => Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(8)).ToLowerInvariant());
        return string.Format(DeviceArgsFormat, deviceId, Uri.EscapeDataString(token));
    }

    /// <summary>
    /// Filmix serves mp4 under /s/{hash}/…; the HLS endpoint serves the same asset as a
    /// master manifest (lampac's hls rewrite).
    /// </summary>
    private static string ToHls(string url)
    {
        var match = System.Text.RegularExpressions.Regex.Match(
            url, @"^(https?://[^/]+)/s/([^/]+)/(.*)$");
        if (!match.Success || url.Contains("/HDR", StringComparison.OrdinalIgnoreCase) ||
            url.Contains("/HEVC", StringComparison.OrdinalIgnoreCase))
            return url;
        return $"{match.Groups[1].Value}/hls/{match.Groups[3].Value}/index.m3u8?hash={match.Groups[2].Value}";
    }

    private static IReadOnlyList<(double Number, FilmixMovie Movie)> ReadSeasonItems(JsonElement value) =>
        value.ValueKind switch
        {
            // voice -> { "1": {link, qualities}, … }
            JsonValueKind.Object => value.EnumerateObject()
                .Select(property => (ParseNumber(property.Name) ?? 0, ReadMovie(property.Value)))
                .Where(item => item.Item1 > 0)
                .ToArray(),
            // voice -> [ {link, qualities}, … ] (positional episode numbers)
            JsonValueKind.Array => value.EnumerateArray()
                .Select((movie, index) => ((double)index + 1, ReadMovie(movie)))
                .ToArray(),
            _ => [],
        };

    private static FilmixMovie ReadMovie(JsonElement element) =>
        new(
            String(element, "link"),
            String(element, "translation"),
            element.TryGetProperty("qualities", out var qualities) && qualities.ValueKind == JsonValueKind.Array
                ? qualities.EnumerateArray()
                    .Select(item => item.TryGetInt32(out var quality) ? quality : 0)
                    .Where(quality => quality > 0)
                    .ToArray()
                : []);

    private static double? ParseNumber(string value) =>
        double.TryParse(value.Replace("серия", string.Empty, StringComparison.OrdinalIgnoreCase).Trim(),
            System.Globalization.CultureInfo.InvariantCulture,
            out var number) ? number : null;

    private static string JoinTitles(string? title, string? original) =>
        !string.IsNullOrWhiteSpace(title) && !string.IsNullOrWhiteSpace(original) && original != title
            ? $"{title} / {original}"
            : title ?? original ?? "Filmix";

    private string ReadToken(ProviderRequestContext context)
    {
        var values = context.RequireAccount(Id, "accessToken", "label");
        if (!values.TryGetValue("accessToken", out var token) || string.IsNullOrWhiteSpace(token))
            throw new ProviderException("Filmix account is incomplete.");
        return token;
    }

    private static ProviderException AccountRequired() =>
        new("An account is required for provider 'filmix'.");

    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    private static string? String(JsonElement element, string name) =>
        element.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static int Int(JsonElement element, string name) =>
        element.TryGetProperty(name, out var property) && property.TryGetInt32(out var value) ? value : 0;

    private sealed record FilmixSearchItem(
        int Id, string? Title, string? OriginalTitle, string? OriginalName, string? Poster, int Year);

    private sealed record FilmixPost([property: JsonPropertyName("player_links")] FilmixPlayerLinks? PlayerLinks);

    private sealed record FilmixPlayerLinks(
        FilmixMovie[]? Movie,
        // season -> voice -> episodes (object keyed by episode number or positional array)
        Dictionary<string, Dictionary<string, JsonElement>>? Playlist);

    private sealed record FilmixMovie(
        [property: JsonPropertyName("link")] string? Link,
        [property: JsonPropertyName("translation")] string? Translation,
        [property: JsonPropertyName("qualities")] int[]? Qualities);

    private sealed record FilmixLocator(
        int PostId,
        string? Translation,
        string? Link,
        int[] Qualities);
}
