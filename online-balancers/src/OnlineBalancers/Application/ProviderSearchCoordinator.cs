using System.Collections.Concurrent;
using System.Text.Json;

namespace OnlineBalancers;

public sealed class ProviderSearchCoordinator
{
    private readonly ProviderRegistry _registry;
    private readonly int _maxConcurrency;

    public ProviderSearchCoordinator(ProviderRegistry registry) : this(registry, 8) { }

    public ProviderSearchCoordinator(ProviderRegistry registry, int maxConcurrency)
    {
        _registry = registry;
        _maxConcurrency = Math.Max(1, maxConcurrency);
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
        CancellationToken cancellationToken)
    {
        var errors = new ConcurrentDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var providers = SelectProviders(providerIds, errors);
        using var semaphore = new SemaphoreSlim(_maxConcurrency, _maxConcurrency);

        var tasks = providers.Select(async provider =>
        {
            await semaphore.WaitAsync(cancellationToken);
            try
            {
                var context = ProviderRequestContext.For(
                    provider,
                    account is not null && string.Equals(account.Provider, provider.Id, StringComparison.OrdinalIgnoreCase)
                        ? account
                        : null);
                return await provider.SearchAsync(query, context, cancellationToken);
            }
            catch (TaskCanceledException exception) when (!cancellationToken.IsCancellationRequested)
            {
                errors[provider.Id] = exception.Message;
                return (IReadOnlyList<SourceItem>)[];
            }
            catch (Exception exception) when (exception is HttpRequestException or ProviderException or JsonException)
            {
                errors[provider.Id] = exception.Message;
                return (IReadOnlyList<SourceItem>)[];
            }
            finally
            {
                semaphore.Release();
            }
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
