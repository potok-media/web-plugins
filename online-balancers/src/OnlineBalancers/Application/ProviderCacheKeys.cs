using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace OnlineBalancers;

internal static class ProviderCacheKeys
{
    public static string Search(string providerId, MediaQuery query, ProviderAccount? account) =>
        Hash("provider-search", providerId, Query(query), Account(account));

    public static string Playback(
        string providerId,
        PlaybackSelection selection,
        ProviderAccount? account) =>
        Hash(
            "provider-playback",
            providerId,
            selection.SourceId,
            Query(selection.Query),
            selection.Season?.ToString(CultureInfo.InvariantCulture),
            selection.Episode?.ToString("R", CultureInfo.InvariantCulture),
            selection.Voice,
            selection.Locator,
            Account(account));

    private static string Query(MediaQuery query) => string.Join('\u001e',
        query.Type,
        query.Title,
        query.OriginalTitle,
        query.ImdbId,
        query.Year?.ToString(CultureInfo.InvariantCulture),
        query.TmdbId?.ToString(CultureInfo.InvariantCulture),
        query.KinopoiskId?.ToString(CultureInfo.InvariantCulture));

    private static string? Account(ProviderAccount? account)
    {
        if (account is null)
            return null;

        return string.Join('\u001e',
            new[] { account.Provider }.Concat(account.Values
                .OrderBy(item => item.Key, StringComparer.Ordinal)
                .Select(item => $"{item.Key}\u001d{item.Value}")));
    }

    private static string Hash(string prefix, params string?[] parts)
    {
        var raw = string.Join('\u001f', parts.Select(part => part ?? ""));
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return $"{prefix}:{Convert.ToHexString(digest)}";
    }
}
