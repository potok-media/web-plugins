using Microsoft.Extensions.Logging;

namespace OnlineBalancers.Providers;

/// <summary>
/// Failure-only logging decorator around an <see cref="IOnlineProvider"/>: a failed
/// operation produces ONE structured Error record (provider, operation, request context,
/// error type/message and the full exception text = the exact failure site) and the
/// exception is rethrown unchanged, so API behavior (502 Problem via ApiEndpoints) stays
/// exactly as before. Successful operations stay silent — the decorator adds zero noise
/// on the happy path.
/// </summary>
public sealed class LoggingOnlineProvider : IOnlineProvider
{
    private const int ContextValueMaxLength = 80;

    private readonly IOnlineProvider _inner;
    private readonly ILogger<LoggingOnlineProvider> _logger;

    public LoggingOnlineProvider(IOnlineProvider inner, string providerId, ILogger<LoggingOnlineProvider> logger)
    {
        _inner = inner;
        Id = providerId;
        _logger = logger;
    }

    public string Id { get; }
    public string Name => _inner.Name;
    public ProviderDescriptor Descriptor => _inner.Descriptor;

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken) =>
        GuardAsync("SearchAsync (search)", () => _inner.SearchAsync(query, cancellationToken), () => Describe(query));

    public Task<IReadOnlyList<SourceItem>> SearchAsync(
        MediaQuery query, ProviderRequestContext context, CancellationToken cancellationToken) =>
        GuardAsync("SearchAsync (search)", () => _inner.SearchAsync(query, context, cancellationToken), () => Describe(query));

    public Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken) =>
        GuardAsync("GetEpisodesAsync (episodes)", () => _inner.GetEpisodesAsync(selection, cancellationToken), () => Describe(selection));

    public Task<EpisodesResult> GetEpisodesAsync(
        SourceSelection selection, ProviderRequestContext context, CancellationToken cancellationToken) =>
        GuardAsync("GetEpisodesAsync (episodes)", () => _inner.GetEpisodesAsync(selection, context, cancellationToken), () => Describe(selection));

    public Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken) =>
        GuardAsync("ResolveAsync (playback)", () => _inner.ResolveAsync(selection, cancellationToken), () => Describe(selection));

    public Task<ResolvedPlayback> ResolveAsync(
        PlaybackSelection selection, ProviderRequestContext context, CancellationToken cancellationToken) =>
        GuardAsync("ResolveAsync (playback)", () => _inner.ResolveAsync(selection, context, cancellationToken), () => Describe(selection));

    private async Task<T> GuardAsync<T>(string operation, Func<Task<T>> call, Func<string> describeContext)
    {
        try
        {
            return await call();
        }
        catch (Exception exception)
        {
            var detail = string.Join('\n', new[]
            {
                "[online-balancers] PROVIDER FAILED",
                $"  provider:    {Id}",
                $"  operation:   {operation}",
                $"  context:     {describeContext()}",
                $"  error:       {exception.GetType().Name}: {exception.Message}",
                $"  stack:       {exception}",
            });
            _logger.LogError("{FailureDetail}", detail);
            throw;
        }
    }

    private static string Describe(MediaQuery query)
    {
        var title = Truncate(query.Title);
        var original = Truncate(query.OriginalTitle);
        var ids = new List<string>();
        if (query.TmdbId is { } tmdb) ids.Add($"tmdb:{tmdb}");
        if (query.KinopoiskId is { } kinopoisk) ids.Add($"kp:{kinopoisk}");
        if (query.Year is { } year) ids.Add($"year:{year}");
        var titles = original is null || original == title
            ? title ?? "(no title)"
            : $"{title} / {original}";
        return ids.Count == 0 ? titles : $"{titles} ({string.Join(", ", ids)})";
    }

    private static string Describe(SourceSelection selection) =>
        $"sourceId: {selection.SourceId}; {Describe(selection.Query)}";

    private static string Describe(PlaybackSelection selection) =>
        $"sourceId: {Truncate(selection.SourceId)}; " +
        $"season/episode/voice: {selection.Season}/{selection.Episode}/{Truncate(selection.Voice)}; " +
        Describe(selection.Query);

    private static string? Truncate(string? value) =>
        value is null ? null : value.Length <= ContextValueMaxLength ? value : value[..ContextValueMaxLength] + "…";
}
