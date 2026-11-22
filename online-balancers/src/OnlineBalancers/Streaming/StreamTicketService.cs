using System.Security.Cryptography;
using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers;

public sealed record StreamTicket(
    Uri Target,
    IReadOnlyDictionary<string, string> Headers);

public sealed class StreamTicketService(IMemoryCache cache)
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(12);

    public string Issue(
        string publicOrigin,
        string targetUrl,
        IReadOnlyDictionary<string, string>? headers = null)
    {
        if (!Uri.TryCreate(targetUrl, UriKind.Absolute, out var target) ||
            target.Scheme is not ("http" or "https") ||
            !string.IsNullOrEmpty(target.UserInfo))
            throw new ProviderException("Provider returned an invalid stream URL.");

        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
        cache.Set(
            CacheKey(token),
            new StreamTicket(
                target,
                headers is null
                    ? new Dictionary<string, string>()
                    : new Dictionary<string, string>(headers, StringComparer.OrdinalIgnoreCase)),
            Lifetime);
        return $"{publicOrigin.TrimEnd('/')}/stream/{token}";
    }

    public bool TryGet(string token, out StreamTicket? ticket) =>
        cache.TryGetValue(CacheKey(token), out ticket);

    private static string CacheKey(string token) => $"stream-ticket:{token}";
}
