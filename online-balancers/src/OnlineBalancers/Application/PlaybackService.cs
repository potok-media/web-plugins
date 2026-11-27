using Microsoft.Extensions.Caching.Hybrid;

namespace OnlineBalancers;

public sealed class PlaybackService
{
    internal static readonly TimeSpan CacheLifetime = TimeSpan.FromMinutes(30);
    internal const int DefaultMaxConcurrency = 8;
    internal const int MaxBatchSize = 512;

    private static readonly HybridCacheEntryOptions CacheOptions = new()
    {
        Expiration = CacheLifetime,
        LocalCacheExpiration = CacheLifetime,
    };

    private readonly ProviderRegistry _registry;
    private readonly StreamTicketService _streamTickets;
    private readonly HybridCache? _cache;
    private readonly int _maxConcurrency;

    public PlaybackService(ProviderRegistry registry, StreamTicketService streamTickets)
        : this(registry, streamTickets, null, DefaultMaxConcurrency) { }

    public PlaybackService(
        ProviderRegistry registry,
        StreamTicketService streamTickets,
        HybridCache cache)
        : this(registry, streamTickets, cache, DefaultMaxConcurrency) { }

    internal PlaybackService(
        ProviderRegistry registry,
        StreamTicketService streamTickets,
        HybridCache? cache,
        int maxConcurrency)
    {
        _registry = registry;
        _streamTickets = streamTickets;
        _cache = cache;
        _maxConcurrency = Math.Max(1, maxConcurrency);
    }

    public async Task<PlaybackResponse> ResolveAsync(
        PlaybackRequest request,
        string publicOrigin,
        CancellationToken cancellationToken)
    {
        var resolved = await ResolveProviderAsync(
            request.Provider,
            Selection(request),
            request.Account,
            cancellationToken);
        return ToResponse(resolved, publicOrigin);
    }

    public async Task<PlaybackBatchResponse> ResolveBatchAsync(
        PlaybackBatchRequest request,
        string publicOrigin,
        CancellationToken cancellationToken)
    {
        if (request.Items.Count > MaxBatchSize)
            throw new ProviderException($"Playback batch cannot contain more than {MaxBatchSize} items.");
        if (request.Items.Any(item => string.IsNullOrWhiteSpace(item.Id)))
            throw new ProviderException("Every playback batch item must have an id.");
        if (request.Items.Select(item => item.Id).Distinct(StringComparer.Ordinal).Count() != request.Items.Count)
            throw new ProviderException("Playback batch item ids must be unique.");

        using var semaphore = new SemaphoreSlim(_maxConcurrency, _maxConcurrency);
        var tasks = request.Items.Select(async item =>
        {
            await semaphore.WaitAsync(cancellationToken);
            try
            {
                var account = request.Accounts is not null
                    && request.Accounts.TryGetValue(item.Provider, out var matched)
                    ? matched
                    : null;
                var resolved = await ResolveProviderAsync(
                    item.Provider,
                    Selection(item),
                    account,
                    cancellationToken);
                return new PlaybackBatchItemResponse(item.Id, ToResponse(resolved, publicOrigin));
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                return new PlaybackBatchItemResponse(item.Id, Error: exception.Message);
            }
            finally
            {
                semaphore.Release();
            }
        });

        return new PlaybackBatchResponse(await Task.WhenAll(tasks));
    }

    private async Task<ResolvedPlayback> ResolveProviderAsync(
        string providerId,
        PlaybackSelection selection,
        ProviderAccount? account,
        CancellationToken cancellationToken)
    {
        var provider = _registry.Get(providerId);
        var context = ProviderRequestContext.For(provider, account);
        if (_cache is null)
            return await provider.ResolveAsync(selection, context, cancellationToken);

        return await _cache.GetOrCreateAsync(
            ProviderCacheKeys.Playback(providerId, selection, account),
            async sharedCancellationToken =>
                await provider.ResolveAsync(selection, context, sharedCancellationToken),
            CacheOptions,
            cancellationToken: cancellationToken);
    }

    private PlaybackResponse ToResponse(ResolvedPlayback resolved, string publicOrigin)
    {
        var streamType = resolved.Url.Contains(".m3u8", StringComparison.OrdinalIgnoreCase) ? "m3u8" : "mp4";
        var streamUrl = _streamTickets.Issue(publicOrigin, resolved.Url, resolved.Headers);
        var variants = resolved.Variants?
            .Select(variant => new PlaybackVariant(
                _streamTickets.Issue(publicOrigin, variant.Url, resolved.Headers)))
            .ToArray();
        return new PlaybackResponse(
            streamUrl,
            streamType,
            resolved.Quality,
            resolved.Voice,
            null,
            variants);
    }

    private static PlaybackSelection Selection(PlaybackRequest request) => new(
        request.SourceId,
        request.Query,
        request.Season,
        request.Episode,
        request.Voice,
        request.Locator);

    private static PlaybackSelection Selection(PlaybackBatchItemRequest request) => new(
        request.SourceId,
        request.Query,
        request.Season,
        request.Episode,
        request.Voice,
        request.Locator);
}
