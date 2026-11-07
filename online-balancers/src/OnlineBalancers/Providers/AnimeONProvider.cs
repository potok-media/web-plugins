using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers.Providers;

/// <summary>
/// AnimeON (animeon.club) — Ukrainian anime service, ported from the lampac AnimeON module
/// (web access). Free: search by title, per-translation Ashdi player episodes carrying a
/// direct file URL; playback resolves the stored file URL. Geo-hides RU/BY — failures land
/// in the LoggingOnlineProvider diagnostics.
/// </summary>
public sealed class AnimeONProvider(HttpClient http, IMemoryCache? cache = null)
    : ProviderBase(http, cache), IOnlineProvider
{
    private const string Host = "https://animeon.club";

    public string Id => "animeon";
    public string Name => "AnimeON";
    public ProviderDescriptor Descriptor => new(Id, Name, "anime");

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        var title = query.Title ?? query.OriginalTitle;
        if (string.IsNullOrWhiteSpace(title))
            return Task.FromResult<IReadOnlyList<SourceItem>>([]);

        return CachedAsync<IReadOnlyList<SourceItem>>(
            $"animeon:search:{title}",
            TimeSpan.FromHours(4),
            async () =>
            {
                using var root = await GetJsonAsync<JsonDocument>(
                    Get($"{Host}/api/anime/search?text={Uri.EscapeDataString(title)}"), cancellationToken);
                if (!root.RootElement.TryGetProperty("result", out var result) ||
                    result.ValueKind != JsonValueKind.Array)
                    return [];

                var mediaType = string.Equals(query.Type, "movie", StringComparison.OrdinalIgnoreCase) ? "movie" : "tv";
                return result.EnumerateArray()
                    .Select(item => new
                    {
                        Id = Int(item, "id"),
                        Season = Int(item, "season"),
                        Title = String(item, "titleUa") ?? String(item, "titleEn"),
                        Year = Int(item, "releaseDate"),
                        Poster = NestedString(item, "image", "preview"),
                    })
                    .Where(item => item.Id > 0)
                    .Select(item => new SourceItem(
                        Id,
                        Name,
                        $"{item.Id}:{item.Season}",
                        item.Title ?? "AnimeON",
                        null,
                        item.Year is > 0 ? item.Year : null,
                        item.Poster is null ? null : $"{Host}/api/uploads/images/{item.Poster}",
                        string.Empty,
                        null,
                        mediaType))
                    .ToArray();
            });
    }

    public async Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken)
    {
        var (animeId, _) = SplitSource(selection.SourceId);
        var translations = await LoadTranslationsAsync(animeId, cancellationToken);
        if (translations.Count == 0)
            return new EpisodesResult([], 0);

        // episode number -> audios across the translations
        var episodes = new Dictionary<double, (string Id, List<AudioItem> Audios)>();
        foreach (var translation in translations)
        {
            var items = await LoadEpisodesAsync(animeId, translation, cancellationToken);
            foreach (var (number, title, fileUrl) in items)
            {
                if (string.IsNullOrWhiteSpace(fileUrl))
                    continue;
                if (!episodes.TryGetValue(number, out var entry))
                {
                    entry = ($"{Id}:{selection.SourceId}:{number:g}", []);
                    episodes.Add(number, entry);
                }
                entry.Audios.Add(new AudioItem(
                    $"{entry.Id}:{entry.Audios.Count}",
                    translation.Title,
                    LocatorCodec.Encode(new AnimeONLocator(fileUrl))));
            }
        }

        var result = episodes
            .OrderBy(episode => episode.Key)
            .Select(episode => new EpisodeItem(
                episode.Value.Id,
                1,
                episode.Key,
                $"{episode.Key:g} серия",
                episode.Value.Audios.FirstOrDefault()?.Name,
                null,
                episode.Value.Audios,
                episode.Value.Audios.FirstOrDefault()?.Locator))
            .ToArray();
        return new EpisodesResult(result, 1);
    }

    public Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken)
    {
        var locator = LocatorCodec.Decode<AnimeONLocator>(
            string.IsNullOrWhiteSpace(selection.Locator)
                ? throw new ProviderException("AnimeON playback locator is missing.")
                : selection.Locator);
        if (string.IsNullOrWhiteSpace(locator.FileUrl))
            throw new ProviderException("AnimeON did not return a playable stream.");
        return Task.FromResult(new ResolvedPlayback(locator.FileUrl, "auto", selection.Voice));
    }

    private Task<IReadOnlyList<AnimeONTranslation>> LoadTranslationsAsync(int animeId, CancellationToken cancellationToken) =>
        CachedAsync<IReadOnlyList<AnimeONTranslation>>(
            $"animeon:translations:{animeId}",
            TimeSpan.FromHours(2),
            async () =>
            {
                using var root = await GetJsonAsync<JsonDocument>(
                    Get($"{Host}/api/player/{animeId}/translations"), cancellationToken);
                if (!root.RootElement.TryGetProperty("translations", out var translations) ||
                    translations.ValueKind != JsonValueKind.Array)
                    return [];

                return translations.EnumerateArray()
                    .Select(item =>
                    {
                        var translationId = NestedInt(item, "translation", "id") ?? 0;
                        var playerId = 0;
                        if (item.TryGetProperty("player", out var players) && players.ValueKind == JsonValueKind.Array)
                            playerId = players.EnumerateArray()
                                .Where(player => string.Equals(
                                    String(player, "name"), "Ashdi", StringComparison.OrdinalIgnoreCase))
                                .Select(player => Int(player, "id"))
                                .FirstOrDefault(id => id > 0);
                        return new AnimeONTranslation(
                            translationId,
                            playerId,
                            NestedString(item, "translation", "name") ?? "Ashdi");
                    })
                    .Where(translation => translation.TranslationId > 0 && translation.PlayerId > 0)
                    .ToArray();
            });

    private Task<IReadOnlyList<(double Number, string Title, string? FileUrl)>> LoadEpisodesAsync(
        int animeId, AnimeONTranslation translation, CancellationToken cancellationToken) =>
        CachedAsync<IReadOnlyList<(double Number, string Title, string? FileUrl)>>(
            $"animeon:episodes:{animeId}:{translation.PlayerId}:{translation.TranslationId}",
            TimeSpan.FromMinutes(40),
            async () =>
            {
                var url = $"{Host}/api/player/{animeId}/episodes?take=100&skip=-1" +
                    $"&playerId={translation.PlayerId}&translationId={translation.TranslationId}";
                using var root = await GetJsonAsync<JsonDocument>(Get(url), cancellationToken);
                if (!root.RootElement.TryGetProperty("episodes", out var episodes) ||
                    episodes.ValueKind != JsonValueKind.Array)
                    return [];

                return episodes.EnumerateArray()
                    .Select(item =>
                    {
                        var number = Int(item, "episode");
                        return (
                            Number: number > 0 ? (double)number : 0,
                            Title: String(item, "title") ?? "Серия",
                            FileUrl: String(item, "fileUrl"));
                    })
                    .Where(item => item.Number > 0)
                    .ToArray();
            });

    private static (int AnimeId, int Season) SplitSource(string sourceId)
    {
        var parts = sourceId.Split(':', 2);
        return (int.TryParse(parts[0], out var animeId) ? animeId : 0,
            parts.Length > 1 && int.TryParse(parts[1], out var season) ? season : 0);
    }

    private static string? String(JsonElement element, string name) =>
        element.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static string? NestedString(JsonElement element, string outer, string inner) =>
        element.TryGetProperty(outer, out var nested) ? String(nested, inner) : null;

    // Tolerant numeric reads: some AnimeON API fields arrive as strings ("7" instead of
    // 7) — parse invariant, fall back to 0 rather than throwing.
    private static int Int(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var property)) return 0;
        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var number)) return number;
        if (property.ValueKind == JsonValueKind.String &&
            int.TryParse(property.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
            return parsed;
        return 0;
    }

    private static int? NestedInt(JsonElement element, string outer, string inner) =>
        element.TryGetProperty(outer, out var nested) ? Int(nested, inner) : null;

    private sealed record AnimeONTranslation(int TranslationId, int PlayerId, string Title);

    private sealed record AnimeONLocator(string FileUrl);
}
