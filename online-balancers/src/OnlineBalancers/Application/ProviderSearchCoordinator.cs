using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace OnlineBalancers;

public sealed class ProviderSearchCoordinator
{
    // Per-provider search budget: a dead upstream can burn ConnectTimeout+request time
    // (~28s) and hold the whole search hostage. Each provider runs under its own linked
    // token; on expiry it lands in errors as a soft timeout the UI can retry.
    public static readonly TimeSpan DefaultPerProviderTimeout = TimeSpan.FromSeconds(8);

    private readonly ProviderRegistry _registry;
    private readonly int _maxConcurrency;
    private readonly TimeSpan _perProviderTimeout;
    private readonly ILogger<ProviderSearchCoordinator>? _logger;

    public ProviderSearchCoordinator(ProviderRegistry registry) : this(registry, 8) { }

    public ProviderSearchCoordinator(ProviderRegistry registry, int maxConcurrency)
        : this(registry, maxConcurrency, DefaultPerProviderTimeout, null) { }

    public ProviderSearchCoordinator(
        ProviderRegistry registry,
        int maxConcurrency,
        TimeSpan perProviderTimeout,
        ILogger<ProviderSearchCoordinator>? logger = null)
    {
        _registry = registry;
        _maxConcurrency = Math.Max(1, maxConcurrency);
        _perProviderTimeout = perProviderTimeout;
        _logger = logger;
    }

    public async Task<SearchResponse> SearchAsync(
        MediaQuery query,
        IReadOnlyList<string>? providerIds,
        CancellationToken cancellationToken) =>
        await SearchAsync(query, providerIds, null, cancellationToken);

    public async Task<SearchResponse> SearchAsync(
        MediaQuery query,
        IReadOnlyList<string>? providerIds,
        ProviderAccount? account,
        CancellationToken cancellationToken) =>
        await SearchStreamingAsync(
            query,
            providerIds,
            account is null ? null : new Dictionary<string, ProviderAccount>(StringComparer.OrdinalIgnoreCase)
            {
                [account.Provider] = account,
            },
            onChunk: null,
            cancellationToken);

    /// <summary>
    /// Search with per-provider streaming: <paramref name="onChunk"/> fires (in completion
    /// order) as soon as each provider finishes — a "provider" chunk with its raw items or
    /// a "provider-error" chunk. Every exception a provider can throw is caught and
    /// reported as its own soft error — one broken provider never fails the search (or the
    /// NDJSON stream). Returns the final ranked response when all providers settled.
    /// </summary>
    public async Task<SearchResponse> SearchStreamingAsync(
        MediaQuery query,
        IReadOnlyList<string>? providerIds,
        IReadOnlyDictionary<string, ProviderAccount>? accounts,
        Func<ProviderSearchChunk, CancellationToken, ValueTask>? onChunk,
        CancellationToken cancellationToken)
    {
        var errors = new ConcurrentDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var providers = SelectProviders(providerIds, errors);
        using var semaphore = new SemaphoreSlim(_maxConcurrency, _maxConcurrency);

        var tasks = providers.Select(async provider =>
        {
            await semaphore.WaitAsync(cancellationToken);
            using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            budget.CancelAfter(_perProviderTimeout);
            IReadOnlyList<SourceItem> items;
            string? error = null;
            try
            {
                var providerAccount = accounts is not null && accounts.TryGetValue(provider.Id, out var matched)
                    ? matched
                    : null;
                var context = ProviderRequestContext.For(provider, providerAccount);
                items = await provider.SearchAsync(query, context, budget.Token);
            }
            catch (OperationCanceledException) when (budget.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
            {
                error = $"Search timed out after {(int)_perProviderTimeout.TotalSeconds} s.";
                items = [];
            }
            catch (TaskCanceledException exception) when (!cancellationToken.IsCancellationRequested)
            {
                error = exception.Message;
                items = [];
            }
            catch (Exception exception) when (exception is HttpRequestException or ProviderException or JsonException)
            {
                error = exception.Message;
                items = [];
            }
            // Catch-all: an unexpected exception of one provider must never fail the
            // batch (or abort the NDJSON stream) for the others.
            catch (Exception exception)
            {
                _logger?.LogWarning(
                    "Search provider {ProviderId} failed with {ExceptionType}: {Message}",
                    provider.Id, exception.GetType().Name, exception.Message);
                error = exception.Message;
                items = [];
            }
            finally
            {
                semaphore.Release();
            }

            if (error is not null)
                errors[provider.Id] = error;
            if (onChunk is not null)
            {
                // Pre-filter chunk items with the same relevance gate the final ranked
                // response uses — a chunk must never surface results FilterAndRank drops.
                var chunkItems = error is null
                    ? items.Where(item => SearchResultRanker.IsRelevant(query, item)).ToArray()
                    : items;
                await onChunk(
                    new ProviderSearchChunk(
                        error is null ? "provider" : "provider-error",
                        provider.Id,
                        chunkItems,
                        error),
                    cancellationToken);
            }
            return items;
        });

        var results = await Task.WhenAll(tasks);
        return new SearchResponse(
            SearchResultRanker.FilterAndRank(query, results.SelectMany(items => items)),
            new Dictionary<string, string>(errors, StringComparer.OrdinalIgnoreCase));
    }

    private IReadOnlyList<IOnlineProvider> SelectProviders(
        IReadOnlyList<string>? providerIds,
        ConcurrentDictionary<string, string> errors)
    {
        if (providerIds is null || providerIds.Count == 0)
            return _registry.All.ToArray();

        var selected = new List<IOnlineProvider>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var id in providerIds)
        {
            if (string.IsNullOrWhiteSpace(id) || !seen.Add(id))
                continue;
            if (_registry.TryGet(id, out var provider))
                selected.Add(provider);
            else
                errors[id] = $"Unknown online provider '{id}'.";
        }
        return selected;
    }
}
