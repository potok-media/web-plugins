using Microsoft.Extensions.Caching.Memory;
using System.Net.Http.Json;

namespace OnlineBalancers.Providers;

public abstract class ProviderBase(HttpClient http, IMemoryCache? cache = null)
{
    protected HttpClient Http { get; } = http;

    protected async Task<string> GetStringAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        using (request)
        using (var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken))
        {
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadAsStringAsync(cancellationToken);
        }
    }

    protected async Task<T> GetJsonAsync<T>(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        using (request)
        using (var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken))
        {
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<T>(cancellationToken: cancellationToken)
                ?? throw new ProviderException("Upstream returned an empty response.");
        }
    }

    protected Task<T> CachedAsync<T>(string key, TimeSpan lifetime, Func<Task<T>> factory)
    {
        if (cache is null)
            return factory();

        return cache.GetOrCreateAsync(key, entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = lifetime;
            return factory();
        })!;
    }

    protected static HttpRequestMessage Get(string url, string? referer = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("Accept", "application/json,text/html;q=0.9,*/*;q=0.8");
        if (!string.IsNullOrWhiteSpace(referer))
            request.Headers.Referrer = new Uri(referer);
        return request;
    }
}
