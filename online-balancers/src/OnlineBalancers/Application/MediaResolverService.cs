using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers;

public interface IMediaResolverService
{
    Task<long?> ResolveKinopoiskIdAsync(MediaQuery query, CancellationToken cancellationToken);
}

public sealed class MediaResolverService(
    HttpClient http,
    IMemoryCache cache,
    string? allohaToken) : IMediaResolverService
{
    public async Task<long?> ResolveKinopoiskIdAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(allohaToken))
            return null;

        if (query.TmdbId is > 0)
        {
            var tmdbId = query.TmdbId.Value.ToString(CultureInfo.InvariantCulture);
            var resolved = await ResolveCachedAsync("tmdb", tmdbId, cancellationToken);
            if (resolved is > 0)
                return resolved;
        }

        var imdbId = query.ImdbId?.Trim();
        if (!string.IsNullOrWhiteSpace(imdbId))
            return await ResolveCachedAsync("imdb", imdbId, cancellationToken);

        return null;
    }

    private Task<long?> ResolveCachedAsync(
        string idType,
        string id,
        CancellationToken cancellationToken) =>
        cache.GetOrCreateAsync(
            $"mediaresolver:kinopoisk:{idType}:{id}",
            entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromDays(7);
                return ResolveAsync(idType, id, cancellationToken);
            });

    private async Task<long?> ResolveAsync(
        string idType,
        string id,
        CancellationToken cancellationToken)
    {
        try
        {
            var url = $"https://api.alloha.tv/?token={Uri.EscapeDataString(allohaToken!)}" +
                $"&{idType}={Uri.EscapeDataString(id)}";
            using var response = await http.GetAsync(url, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return null;

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            if (!document.RootElement.TryGetProperty("data", out var data) ||
                data.ValueKind != JsonValueKind.Object ||
                !data.TryGetProperty("id_kp", out var kinopoiskId))
                return null;

            return kinopoiskId.ValueKind switch
            {
                JsonValueKind.Number when kinopoiskId.TryGetInt64(out var numeric) && numeric > 0 => numeric,
                JsonValueKind.String when long.TryParse(
                    kinopoiskId.GetString(),
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out var text) && text > 0 => text,
                _ => null,
            };
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (exception is HttpRequestException or JsonException or TaskCanceledException)
        {
            return null;
        }
    }
}
