using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers.Providers;

public sealed class KinoPubProvider(HttpClient http, IMemoryCache? cache = null)
    : ProviderBase(http, cache), IOnlineProvider
{
    private const string ApiHost = "https://api.srvkp.com";

    public string Id => "kinopub";
    public string Name => "KinoWatch (KinoPub)";
    public ProviderDescriptor Descriptor => new(Id, Name, "general", "account", "device-code");

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
        var token = ReadToken(context);
        var searchQueries = new List<string>();

        // Prefer Title (localized name, e.g. "Менталист") because Russian balancers index Russian titles
        if (!string.IsNullOrWhiteSpace(query.Title))
            searchQueries.Add(query.Title.Trim());

        // Also query OriginalTitle (e.g. "The Mentalist") if provided and different
        if (!string.IsNullOrWhiteSpace(query.OriginalTitle) &&
            !searchQueries.Contains(query.OriginalTitle.Trim(), StringComparer.OrdinalIgnoreCase))
        {
            searchQueries.Add(query.OriginalTitle.Trim());
        }

        if (searchQueries.Count == 0)
            return [];

        var seenIds = new HashSet<int>();
        var exactMatches = new List<SourceItem>();
        var otherMatches = new List<SourceItem>();

        foreach (var searchTitle in searchQueries)
        {
            var url = $"{ApiHost}/v1/items/search?q={Uri.EscapeDataString(searchTitle)}" +
                $"&access_token={Uri.EscapeDataString(token)}&field=title&perpage=200";

            try
            {
                using var root = await GetJsonAsync<JsonDocument>(Get(url), cancellationToken);
                if (!TryProperty(root.RootElement, "items", out var items) || items.ValueKind != JsonValueKind.Array)
                    continue;

                foreach (var element in items.EnumerateArray())
                {
                    var id = Int(element, "id");
                    if (id is null || !seenIds.Add(id.Value))
                        continue;

                    var mapped = MapSource(element);
                    if (mapped is null)
                        continue;

                    var isExactId = (Int(element, "kinopoisk") is { } kp && kp > 0 && query.KinopoiskId.HasValue && kp == query.KinopoiskId.Value) ||
                                    (Int(element, "imdb") is { } imdb && imdb > 0 && !string.IsNullOrWhiteSpace(query.ImdbId) &&
                                     ($"tt{imdb}" == query.ImdbId || imdb.ToString(CultureInfo.InvariantCulture) == query.ImdbId));

                    if (isExactId)
                    {
                        if (string.IsNullOrWhiteSpace(mapped.OriginalTitle) && !string.IsNullOrWhiteSpace(query.OriginalTitle))
                        {
                            mapped = mapped with { OriginalTitle = query.OriginalTitle };
                        }
                        exactMatches.Add(mapped);
                    }
                    else
                    {
                        otherMatches.Add(mapped);
                    }
                }
            }
            catch (Exception) when (!cancellationToken.IsCancellationRequested)
            {
                // Continue with next query
            }
        }

        return [.. exactMatches, .. otherMatches];
    }

    public async Task<EpisodesResult> GetEpisodesAsync(
        SourceSelection selection,
        ProviderRequestContext context,
        CancellationToken cancellationToken)
    {
        var token = ReadToken(context);
        using var root = await LoadItemAsync(selection.SourceId, token, cancellationToken);
        var item = Item(root.RootElement);
        if (!TryProperty(item, "seasons", out var seasons) || seasons.ValueKind != JsonValueKind.Array)
            return new EpisodesResult([], 0);

        var episodes = new List<EpisodeItem>();
        foreach (var season in seasons.EnumerateArray())
        {
            var seasonNumber = Int(season, "number") ?? 1;
            if (!TryProperty(season, "episodes", out var seasonEpisodes) || seasonEpisodes.ValueKind != JsonValueKind.Array)
                continue;
            foreach (var episode in seasonEpisodes.EnumerateArray())
            {
                var episodeNumber = Int(episode, "number") ?? episodes.Count + 1;
                var audios = BuildAudios(selection.SourceId, seasonNumber, episodeNumber, episode);
                var fallback = audios.FirstOrDefault() ?? new AudioItem(
                    $"{Id}:{seasonNumber}:{episodeNumber}:0",
                    "Основной поток",
                    LocatorCodec.Encode(new KinoPubLocator(selection.SourceId, seasonNumber, episodeNumber, 1, "Основной поток")));
                episodes.Add(new EpisodeItem(
                    Id: $"{Id}:{selection.SourceId}:{seasonNumber}:{episodeNumber}",
                    Season: seasonNumber,
                    Number: episodeNumber,
                    Title: $"{episodeNumber} серия",
                    Voice: fallback.Name,
                    Url: null,
                    Audios: audios.Length == 0 ? [fallback] : audios,
                    Locator: fallback.Locator));
            }
        }

        return new EpisodesResult(episodes, episodes.Count == 0 ? 0 : episodes.Max(item => item.Season));
    }

    public async Task<ResolvedPlayback> ResolveAsync(
        PlaybackSelection selection,
        ProviderRequestContext context,
        CancellationToken cancellationToken)
    {
        var token = ReadToken(context);
        var locator = string.IsNullOrWhiteSpace(selection.Locator)
            ? new KinoPubLocator(
                selection.SourceId,
                selection.Season,
                selection.Episode is null ? null : (int)selection.Episode.Value,
                1,
                selection.Voice)
            : LocatorCodec.Decode<KinoPubLocator>(selection.Locator);
        using var root = await LoadItemAsync(locator.SourceId, token, cancellationToken);
        var item = Item(root.RootElement);
        var video = SelectVideo(item, locator)
            ?? throw new ProviderException("KinoWatch (KinoPub) did not return a playable video.");
        if (!TryProperty(video, "files", out var files) || files.ValueKind != JsonValueKind.Array)
            throw new ProviderException("KinoWatch (KinoPub) did not return video files.");

        var streams = files.EnumerateArray()
            .Select(file => new
            {
                Quality = String(file, "quality") ?? "720p",
                Hls = NestedString(file, "url", "hls"),
                Http = NestedString(file, "url", "http"),
            })
            .Select(file => new
            {
                file.Quality,
                Url = !string.IsNullOrWhiteSpace(file.Hls)
                    ? ReplaceAudio(file.Hls!, locator.AudioIndex)
                    : file.Http,
            })
            .Where(file => !string.IsNullOrWhiteSpace(file.Url))
            .OrderByDescending(file => QualityNumber(file.Quality))
            .ToArray();
        var best = streams.FirstOrDefault()
            ?? throw new ProviderException("KinoWatch (KinoPub) did not return a playable stream.");
        return new ResolvedPlayback(ProviderParsing.AbsoluteHttps(best.Url!), best.Quality, locator.Voice);
    }

    private async Task<JsonDocument> LoadItemAsync(
        string sourceId,
        string token,
        CancellationToken cancellationToken) =>
        await GetJsonAsync<JsonDocument>(Get(
            $"{ApiHost}/v1/items/{Uri.EscapeDataString(sourceId)}?access_token={Uri.EscapeDataString(token)}"),
            cancellationToken);

    private static AudioItem[] BuildAudios(string sourceId, int season, int episode, JsonElement video)
    {
        if (!TryProperty(video, "audios", out var audios) || audios.ValueKind != JsonValueKind.Array)
            return [];
        return audios.EnumerateArray().Select((audio, index) =>
        {
            var audioIndex = Int(audio, "index") ?? index + 1;
            var voice = NestedString(audio, "author", "title")
                ?? NestedString(audio, "type", "title")
                ?? String(audio, "lang")
                ?? $"Аудио {index + 1}";
            var locator = LocatorCodec.Encode(new KinoPubLocator(sourceId, season, episode, audioIndex, voice));
            return new AudioItem($"{IdValue}:{season}:{episode}:{audioIndex}", voice, locator);
        }).ToArray();
    }

    private static SourceItem? MapSource(JsonElement item)
    {
        var id = Int(item, "id");
        var title = String(item, "title");
        if (id is null || string.IsNullOrWhiteSpace(title))
            return null;

        var origTitle = String(item, "original_title") ?? String(item, "originalTitle");
        if (string.IsNullOrWhiteSpace(origTitle) && title.Contains('/'))
        {
            var parts = title.Split(['/'], 2, StringSplitOptions.TrimEntries);
            if (parts.Length > 1 && !string.IsNullOrWhiteSpace(parts[1]))
            {
                origTitle = parts[1];
            }
        }

        var type = String(item, "type");
        return new SourceItem(
            IdValue,
            "KinoWatch (KinoPub)",
            id.Value.ToString(CultureInfo.InvariantCulture),
            title,
            origTitle,
            Int(item, "year"),
            TryProperty(item, "posters", out var posters) ? FindFirstUrl(posters) : null,
            (Int(item, "quality") is { } quality ? $"{quality}p" : "2160p"),
            String(item, "voice"),
            type is "movie" or "film" ? "movie" : "tv");
    }

    private static JsonElement? SelectVideo(JsonElement item, KinoPubLocator locator)
    {
        if (locator.Season is > 0 && TryProperty(item, "seasons", out var seasons))
        {
            var season = seasons.EnumerateArray().FirstOrDefault(value => Int(value, "number") == locator.Season);
            if (season.ValueKind != JsonValueKind.Undefined && TryProperty(season, "episodes", out var episodes))
            {
                var episode = episodes.EnumerateArray().FirstOrDefault(value => Int(value, "number") == locator.Episode);
                if (episode.ValueKind != JsonValueKind.Undefined)
                    return episode;
            }
        }
        if (TryProperty(item, "videos", out var videos) && videos.ValueKind == JsonValueKind.Array)
        {
            var video = videos.EnumerateArray().FirstOrDefault();
            if (video.ValueKind != JsonValueKind.Undefined)
                return video;
        }
        return null;
    }

    private static string ReadToken(ProviderRequestContext context)
    {
        var values = context.RequireAccount(IdValue, "accessToken", "label");
        if (!values.TryGetValue("accessToken", out var token) || string.IsNullOrWhiteSpace(token))
            throw new ProviderException("KinoWatch (KinoPub) account is incomplete.");
        return token;
    }

    private static JsonElement Item(JsonElement root) =>
        TryProperty(root, "item", out var item) && item.ValueKind == JsonValueKind.Object ? item : root;

    private static bool TryProperty(JsonElement element, string name, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
            }
        }
        value = default;
        return false;
    }

    private static string? String(JsonElement element, string name) =>
        TryProperty(element, name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static int? Int(JsonElement element, string name)
    {
        if (!TryProperty(element, name, out var value))
            return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
            return number;
        return value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out number) ? number : null;
    }

    private static string? NestedString(JsonElement element, string parent, string name) =>
        TryProperty(element, parent, out var child) ? String(child, name) : null;

    private static string? FindFirstUrl(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.String)
        {
            var value = element.GetString();
            return Uri.TryCreate(value, UriKind.Absolute, out _) ? value : null;
        }
        if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var child in element.EnumerateArray())
                if (FindFirstUrl(child) is { } value) return value;
        }
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var child in element.EnumerateObject())
                if (FindFirstUrl(child.Value) is { } value) return value;
        }
        return null;
    }

    private static string ReplaceAudio(string url, int index) =>
        url.Replace("a1.m3u8", $"a{Math.Max(1, index)}.m3u8", StringComparison.OrdinalIgnoreCase);

    private static int QualityNumber(string value)
    {
        var digits = new string(value.Where(char.IsDigit).ToArray());
        return int.TryParse(digits, out var number) ? number : 0;
    }

    private static ProviderException AccountRequired() =>
        new($"An account is required for provider '{IdValue}'.");

    private const string IdValue = "kinopub";
    private sealed record KinoPubLocator(
        string SourceId,
        int? Season,
        int? Episode,
        int AudioIndex,
        string? Voice);
}
