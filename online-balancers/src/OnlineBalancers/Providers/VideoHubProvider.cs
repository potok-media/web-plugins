using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers.Providers;

public sealed partial class VideoHubProvider(HttpClient http, IMemoryCache? cache = null)
    : ProviderBase(http, cache), IOnlineProvider
{
    private const string Host = "https://plapi.cdnvideohub.com";
    private const string Referer = "https://hdkino.pub/";

    public string Id => "videohub";
    public string Name => "VideoHUB";
    public ProviderDescriptor Descriptor => new(Id, Name, "movies");

    public async Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        if (query.KinopoiskId is not > 0)
            return [];
        var playlist = await GetPlaylistAsync(query.KinopoiskId.Value, cancellationToken);
        if (playlist.Items is null || playlist.Items.Length == 0)
            return [];
        return [new SourceItem(
            Id,
            Name,
            query.KinopoiskId.Value.ToString(System.Globalization.CultureInfo.InvariantCulture),
            query.Title ?? query.OriginalTitle ?? Name,
            query.OriginalTitle,
            query.Year,
            null,
            "1080p",
            null,
            playlist.IsSerial ? "tv" : "movie")];
    }

    public async Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken)
    {
        if (!long.TryParse(selection.SourceId, out var kinopoiskId))
            throw new ProviderException("VideoHUB source id is invalid.");
        var playlist = await GetPlaylistAsync(kinopoiskId, cancellationToken);
        if (!playlist.IsSerial)
            return new EpisodesResult([], 0);

        var episodes = (playlist.Items ?? [])
            .Where(item => !string.IsNullOrWhiteSpace(item.VkId))
            .GroupBy(item => (Season: Math.Max(1, item.Season), Episode: Math.Max(1, item.Episode)))
            .OrderBy(group => group.Key.Season)
            .ThenBy(group => group.Key.Episode)
            .Select(group =>
            {
                var audios = group.Select((item, index) =>
                {
                    var name = item.VoiceStudio ?? item.VoiceType ?? $"Аудио {index + 1}";
                    return new AudioItem(
                        $"{Id}:{group.Key.Season}:{group.Key.Episode}:{index}",
                        name,
                        LocatorCodec.Encode(new VideoHubLocator(item.VkId!, name)));
                }).ToArray();
                return new EpisodeItem(
                    Id: $"{Id}:{selection.SourceId}:{group.Key.Season}:{group.Key.Episode}",
                    Season: group.Key.Season,
                    Number: group.Key.Episode,
                    Title: $"{group.Key.Episode} серия",
                    Voice: audios[0].Name,
                    Url: null,
                    Audios: audios,
                    Locator: audios[0].Locator);
            }).ToArray();
        return new EpisodesResult(episodes, episodes.Length == 0 ? 0 : episodes.Max(item => item.Season));
    }

    public async Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken)
    {
        var locator = LocatorCodec.Decode<VideoHubLocator>(selection.Locator);
        var request = Get($"{Host}/api/v1/player/sv/video/{Uri.EscapeDataString(locator.VkId)}", Referer);
        var payload = await GetStringAsync(request, cancellationToken);
        var hls = TryReadHls(payload) ?? throw new ProviderException("VideoHUB did not return a playable stream.");
        return new ResolvedPlayback(
            ProviderParsing.AbsoluteHttps(hls.Replace("\\u0026", "&", StringComparison.Ordinal)),
            "1080p",
            locator.Voice,
            new Dictionary<string, string> { ["Referer"] = Referer });
    }

    private Task<VideoHubRoot> GetPlaylistAsync(long kinopoiskId, CancellationToken cancellationToken) =>
        CachedAsync($"videohub:playlist:{kinopoiskId}", TimeSpan.FromHours(4), () =>
            GetJsonAsync<VideoHubRoot>(
                Get($"{Host}/api/v1/player/sv/playlist?pub=12&aggr=kp&id={kinopoiskId}", Referer),
                cancellationToken));

    private static string? TryReadHls(string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            return FindString(document.RootElement, "hlsUrl");
        }
        catch (JsonException)
        {
            return HlsRegex().Match(payload).Groups[1].Value;
        }
    }

    private static string? FindString(JsonElement element, string name)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (property.NameEquals(name) && property.Value.ValueKind == JsonValueKind.String)
                    return property.Value.GetString();
                var nested = FindString(property.Value, name);
                if (!string.IsNullOrWhiteSpace(nested))
                    return nested;
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                var nested = FindString(item, name);
                if (!string.IsNullOrWhiteSpace(nested))
                    return nested;
            }
        }
        return null;
    }

    private sealed record VideoHubLocator(string VkId, string Voice);

    private sealed class VideoHubRoot
    {
        public bool IsSerial { get; init; }
        public VideoHubItem[]? Items { get; init; }
    }

    private sealed class VideoHubItem
    {
        public int Season { get; init; }
        public int Episode { get; init; }
        public string? VoiceStudio { get; init; }
        public string? VoiceType { get; init; }
        public string? VkId { get; init; }
    }

    [GeneratedRegex("\\\"hlsUrl\\\"\\s*:\\s*\\\"([^\\\"]+)", RegexOptions.IgnoreCase)]
    private static partial Regex HlsRegex();
}
