using System.Globalization;
using System.Text;
using System.Text.Json;

namespace OnlineBalancers;

public static class LocatorCodec
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static string Encode<T>(T value) => Base64Url.Encode(JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions));

    public static T Decode<T>(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new ProviderException("Playback locator is missing.");

        try
        {
            return JsonSerializer.Deserialize<T>(Base64Url.Decode(value), JsonOptions)
                ?? throw new ProviderException("Playback locator is empty.");
        }
        catch (ProviderException)
        {
            throw;
        }
        catch (Exception exception) when (exception is FormatException or JsonException)
        {
            throw new ProviderException("Playback locator is invalid.");
        }
    }
}

public static class Base64Url
{
    public static string Encode(ReadOnlySpan<byte> bytes) => Convert.ToBase64String(bytes)
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');

    public static byte[] Decode(string value)
    {
        var base64 = value.Replace('-', '+').Replace('_', '/');
        base64 += new string('=', (4 - base64.Length % 4) % 4);
        return Convert.FromBase64String(base64);
    }
}

public static class ProviderParsing
{
    public static double EpisodeNumber(string? value, int fallback)
    {
        if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number))
            return number;
        return fallback;
    }

    public static string AbsoluteHttps(string value)
    {
        if (value.StartsWith("//", StringComparison.Ordinal))
            return "https:" + value;
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
            return uri.ToString();
        throw new ProviderException("Upstream returned an invalid stream URL.");
    }

    public static string NormalizeTitle(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;

        var normalized = value.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(normalized.Length);
        foreach (var character in normalized)
        {
            var category = CharUnicodeInfo.GetUnicodeCategory(character);
            if (category == UnicodeCategory.NonSpacingMark)
                continue;
            builder.Append(char.IsLetterOrDigit(character) ? char.ToLowerInvariant(character) : ' ');
        }
        return string.Join(' ', builder.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }
}
