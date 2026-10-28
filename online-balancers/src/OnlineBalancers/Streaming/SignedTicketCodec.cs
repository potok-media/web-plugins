using System.Security.Cryptography;
using System.Text.Json;

namespace OnlineBalancers;

public sealed class SignedTicketCodec
{
    private const char Separator = '~';
    private readonly byte[] _key = RandomNumberGenerator.GetBytes(32);
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web);

    public string Issue<T>(T value)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(value, _jsonOptions);
        var signature = HMACSHA256.HashData(_key, payload);
        return $"{Base64Url.Encode(payload)}{Separator}{Base64Url.Encode(signature)}";
    }

    public T Read<T>(string token)
    {
        var separator = token.LastIndexOf(Separator);
        if (separator <= 0 || separator == token.Length - 1)
            throw new ProviderException("Signed ticket is invalid.");

        try
        {
            var payload = Base64Url.Decode(token[..separator]);
            var signature = Base64Url.Decode(token[(separator + 1)..]);
            var expected = HMACSHA256.HashData(_key, payload);
            if (!CryptographicOperations.FixedTimeEquals(signature, expected))
                throw new ProviderException("Signed ticket is invalid.");
            return JsonSerializer.Deserialize<T>(payload, _jsonOptions)
                ?? throw new ProviderException("Signed ticket is empty.");
        }
        catch (ProviderException)
        {
            throw;
        }
        catch (Exception exception) when (exception is FormatException or JsonException)
        {
            throw new ProviderException("Signed ticket is invalid.");
        }
    }
}
