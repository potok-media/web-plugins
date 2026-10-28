using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace OnlineBalancers;

public sealed class EncryptedTicketCodec(TimeProvider? timeProvider = null)
{
    private const string VersionPrefix = "e2_";
    private const int NonceSize = 12;
    private const int TagSize = 16;
    private readonly byte[] _key = RandomNumberGenerator.GetBytes(32);
    private readonly TimeProvider _timeProvider = timeProvider ?? TimeProvider.System;
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web);

    public string Issue<T>(T value, string purpose, TimeSpan? lifetime = null)
    {
        var envelope = new Envelope<T>(
            _timeProvider.GetUtcNow().Add(lifetime ?? TimeSpan.FromMinutes(10)).ToUnixTimeSeconds(),
            value);
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(envelope, _jsonOptions);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagSize];
        using var cipher = new AesGcm(_key, TagSize);
        cipher.Encrypt(nonce, plaintext, ciphertext, tag, Encoding.UTF8.GetBytes(purpose));

        var protectedPayload = new byte[NonceSize + ciphertext.Length + TagSize];
        nonce.CopyTo(protectedPayload, 0);
        ciphertext.CopyTo(protectedPayload, NonceSize);
        tag.CopyTo(protectedPayload, NonceSize + ciphertext.Length);
        return VersionPrefix + Base64Url.Encode(protectedPayload);
    }

    public T Read<T>(string token, string purpose)
    {
        try
        {
            if (!token.StartsWith(VersionPrefix, StringComparison.Ordinal))
                throw new ProviderException("Encrypted ticket is invalid.");

            var protectedPayload = Base64Url.Decode(token[VersionPrefix.Length..]);
            if (protectedPayload.Length <= NonceSize + TagSize)
                throw new ProviderException("Encrypted ticket is invalid.");
            var nonce = protectedPayload.AsSpan(0, NonceSize);
            var ciphertext = protectedPayload.AsSpan(NonceSize, protectedPayload.Length - NonceSize - TagSize);
            var tag = protectedPayload.AsSpan(protectedPayload.Length - TagSize, TagSize);
            var plaintext = new byte[ciphertext.Length];
            using var cipher = new AesGcm(_key, TagSize);
            cipher.Decrypt(nonce, ciphertext, tag, plaintext, Encoding.UTF8.GetBytes(purpose));
            var envelope = JsonSerializer.Deserialize<Envelope<T>>(plaintext, _jsonOptions)
                ?? throw new ProviderException("Encrypted ticket is empty.");
            if (_timeProvider.GetUtcNow().ToUnixTimeSeconds() > envelope.ExpiresAt)
                throw new ProviderException("Encrypted ticket has expired.");
            return envelope.Value;
        }
        catch (ProviderException)
        {
            throw;
        }
        catch (Exception exception) when (exception is FormatException or JsonException or CryptographicException)
        {
            throw new ProviderException("Encrypted ticket is invalid.");
        }
    }

    private sealed record Envelope<T>(long ExpiresAt, T Value);
}
