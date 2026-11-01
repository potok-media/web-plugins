namespace OnlineBalancers;

public sealed record MediaQuery(
    string? Type,
    string? Title,
    string? OriginalTitle,
    string? ImdbId,
    int? Year,
    long? TmdbId,
    long? KinopoiskId);

public sealed record ProviderAccount(string Provider, IReadOnlyDictionary<string, string> Values);

public sealed record ProviderRequestContext(ProviderAccount? Account)
{
    public static ProviderRequestContext Empty { get; } = new((ProviderAccount?)null);

    public static ProviderRequestContext For(IOnlineProvider provider, ProviderAccount? account)
    {
        if (account is not null && !string.Equals(account.Provider, provider.Id, StringComparison.OrdinalIgnoreCase))
            throw new ProviderException("Account does not match the selected provider.");
        if (provider.Descriptor.RequiresAccount && account is null)
            throw new ProviderException($"An account is required for provider '{provider.Id}'.");
        if (account?.Values.Count > 16)
            throw new ProviderException("Provider account contains too many fields.");
        if (account?.Values.Any(item => item.Key.Length > 64 || item.Value.Length > 16_384) == true)
            throw new ProviderException("Provider account is invalid.");
        return new ProviderRequestContext(account);
    }

    public IReadOnlyDictionary<string, string> RequireAccount(
        string providerId,
        params string[] allowedFields)
    {
        if (Account is null || !string.Equals(Account.Provider, providerId, StringComparison.OrdinalIgnoreCase))
            throw new ProviderException($"An account is required for provider '{providerId}'.");

        var allowed = allowedFields.ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (Account.Values.Keys.Any(key => !allowed.Contains(key)))
            throw new ProviderException("Provider account contains unsupported fields.");
        return Account.Values;
    }
}

public sealed record SearchRequest(
    MediaQuery Query,
    IReadOnlyList<string>? Providers = null,
    ProviderAccount? Account = null);

public sealed record SourceSelection(string SourceId, MediaQuery Query);

public sealed record EpisodesRequest(
    string Provider,
    string SourceId,
    MediaQuery Query,
    ProviderAccount? Account = null);

public sealed record PlaybackRequest(
    string Provider,
    string SourceId,
    MediaQuery Query,
    int? Season,
    double? Episode,
    string? Voice,
    string? Locator,
    ProviderAccount? Account = null);

public sealed record SourceSelectionRequest(string SourceId, MediaQuery Query);

public sealed record PlaybackSelection(
    string SourceId,
    MediaQuery Query,
    int? Season,
    double? Episode,
    string? Voice,
    string? Locator);

public sealed record KinoPubDevicePollRequest(string Code);

public sealed record RezkaLoginRequest(string Host, string Login, string Password);
