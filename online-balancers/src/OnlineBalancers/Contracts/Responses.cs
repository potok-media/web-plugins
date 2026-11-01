using System.Text.Json.Serialization;

namespace OnlineBalancers;

public sealed record ProviderDescriptor(
    string Id,
    string Name,
    string Category = "general",
    string Access = "free",
    string? AuthMode = null)
{
    public bool RequiresAccount => string.Equals(Access, "account", StringComparison.OrdinalIgnoreCase);
}

public sealed record SourceItem(
    string Provider,
    string ProviderName,
    string SourceId,
    string Title,
    string? OriginalTitle,
    int? Year,
    string? Poster,
    string Quality,
    string? Voice,
    string MediaType);

public sealed record AudioItem(string Id, string Name, string Locator, string? Url = null);

public sealed record EpisodeItem(
    string Id,
    int Season,
    double Number,
    string Title,
    string? Voice,
    string? Url,
    IReadOnlyList<AudioItem> Audios,
    [property: JsonIgnore]
    string? Locator);

public sealed record EpisodesResult(IReadOnlyList<EpisodeItem> Episodes, int SeasonsCount);

public sealed record ResolvedPlayback(
    string Url,
    string Quality,
    string? Voice,
    IReadOnlyDictionary<string, string>? Headers = null);

public sealed record SearchResponse(IReadOnlyList<SourceItem> Items, IReadOnlyDictionary<string, string> Errors);

public sealed record PlaybackResponse(
    string StreamUrl,
    string StreamType,
    string Quality,
    string? Voice,
    IReadOnlyDictionary<string, string>? Headers = null);

public sealed record DeviceCodeResponse(
    string Code,
    string UserCode,
    string VerificationUri,
    int? ExpiresIn,
    int? Interval);

public sealed record AccountConnectionResponse(ProviderAccount Account);
