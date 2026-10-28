namespace OnlineBalancers;

public sealed class ProviderRegistry
{
    private readonly IReadOnlyDictionary<string, IOnlineProvider> _providers;

    public ProviderRegistry(IEnumerable<IOnlineProvider> providers)
    {
        var discovered = providers.ToArray();
        var duplicate = discovered
            .GroupBy(provider => provider.Id, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(group => group.Count() > 1);
        if (duplicate is not null)
            throw new ProviderException($"Duplicate online provider id '{duplicate.Key}'.");

        _providers = discovered.ToDictionary(provider => provider.Id, StringComparer.OrdinalIgnoreCase);
    }

    public IReadOnlyCollection<IOnlineProvider> All => _providers.Values.ToArray();

    public bool TryGet(string id, out IOnlineProvider provider) => _providers.TryGetValue(id, out provider!);

    public IOnlineProvider Get(string id) => TryGet(id, out var provider)
        ? provider
        : throw new ProviderException($"Unknown online provider '{id}'.");
}
