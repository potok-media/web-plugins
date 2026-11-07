using System.Net;
using System.Text.Json;
using OnlineBalancers.Providers;

namespace OnlineBalancers;

public sealed class AccountConnectionService(IHttpClientFactory clients)
{
    private const string KinoPubHost = "https://api.srvkp.com";
    private const string KinoPubClientId = "xbmc";
    private const string KinoPubClientSecret = "cgg3gtifu46urtfp2zp1nqtba0k2ezxh";
    private const string FilmixHost = "https://filmix.my";

    public async Task<DeviceCodeResponse> StartKinoPubAsync(CancellationToken cancellationToken)
    {
        var url = $"{KinoPubHost}/oauth2/device?grant_type=device_code" +
            $"&client_id={KinoPubClientId}&client_secret={KinoPubClientSecret}";
        using var root = await PostEmptyJsonAsync(url, cancellationToken);
        var element = root.RootElement;
        return new DeviceCodeResponse(
            RequiredString(element, "code"),
            RequiredString(element, "user_code"),
            "https://kino.watch/device",
            OptionalInt(element, "expires_in"),
            OptionalInt(element, "interval"));
    }

    public async Task<AccountConnectionResponse> PollKinoPubAsync(
        KinoPubDevicePollRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Code) || request.Code.Length > 512)
            throw new ProviderException("KinoWatch (KinoPub) device code is invalid.");
        var url = $"{KinoPubHost}/oauth2/device?grant_type=device_token" +
            $"&client_id={KinoPubClientId}&client_secret={KinoPubClientSecret}" +
            $"&code={Uri.EscapeDataString(request.Code)}";
        using var root = await PostEmptyJsonAsync(url, cancellationToken);
        var token = RequiredString(root.RootElement, "access_token");
        return new AccountConnectionResponse(new ProviderAccount(
            "kinopub",
            new Dictionary<string, string> { ["accessToken"] = token }));
    }

    // Filmix exposes no activation-status endpoint (the lampac flow shows a user_code and
    // the issued `code` simply becomes the token once the user links the device on the
    // site). Start issues the pair; poll stores the code as the access token — the first
    // provider call validates it for real and surfaces a clear error if the user has not
    // activated yet.
    public async Task<DeviceCodeResponse> StartFilmixAsync(CancellationToken cancellationToken)
    {
        var deviceId = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
        var url = $"{FilmixHost}/api/v2/token_request?user_dev_apk=2.2.13&user_dev_id={deviceId}" +
            "&user_dev_name=Xiaomi&user_dev_os=12&user_dev_vendor=Xiaomi&user_dev_token=";
        using var root = await GetJsonAsync(url, cancellationToken);
        var element = root.RootElement;
        return new DeviceCodeResponse(
            RequiredString(element, "code"),
            RequiredString(element, "user_code"),
            "https://filmix.my/consoles",
            null,
            null);
    }

    public Task<AccountConnectionResponse> PollFilmixAsync(
        KinoPubDevicePollRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Code) || request.Code.Length > 512)
            throw new ProviderException("Filmix device code is invalid.");
        return Task.FromResult(new AccountConnectionResponse(new ProviderAccount(
            "filmix",
            new Dictionary<string, string> { ["accessToken"] = request.Code })));
    }

    public async Task<AccountConnectionResponse> LoginRezkaAsync(
        RezkaLoginRequest request,
        CancellationToken cancellationToken)
    {
        var host = RezkaProvider.ValidateHost(request.Host);
        if (string.IsNullOrWhiteSpace(request.Login) || request.Login.Length > 320 ||
            string.IsNullOrWhiteSpace(request.Password) || request.Password.Length > 1024)
            throw new ProviderException("Rezka credentials are invalid.");

        using var message = new HttpRequestMessage(
            HttpMethod.Post,
            $"{host}/ajax/login/?t={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}");
        message.Content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["login_name"] = request.Login,
            ["login_password"] = request.Password,
            ["login_not_save"] = "0",
        });
        message.Headers.TryAddWithoutValidation("X-Requested-With", "XMLHttpRequest");
        message.Headers.TryAddWithoutValidation("Origin", host);
        message.Headers.Referrer = new Uri(host + "/");

        using var response = await clients.CreateClient("upstream")
            .SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var root = await response.Content.ReadFromJsonAsync<JsonDocument>(cancellationToken: cancellationToken)
            ?? throw new ProviderException("Rezka returned an empty login response.");
        if (!root.RootElement.TryGetProperty("success", out var success) || success.ValueKind != JsonValueKind.True)
            throw new ProviderException("Rezka rejected the account credentials.");

        var cookies = ReadSessionCookies(response);
        if (string.IsNullOrWhiteSpace(cookies))
            throw new ProviderException("Rezka did not return an account session.");
        return new AccountConnectionResponse(new ProviderAccount(
            "rezka",
            new Dictionary<string, string>
            {
                ["host"] = host,
                ["cookie"] = cookies,
                ["label"] = request.Login,
            }));
    }

    private async Task<JsonDocument> PostEmptyJsonAsync(string url, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(string.Empty),
        };
        using var response = await clients.CreateClient("upstream")
            .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonDocument>(cancellationToken: cancellationToken)
            ?? throw new ProviderException("Account provider returned an empty response.");
    }

    private async Task<JsonDocument> GetJsonAsync(string url, CancellationToken cancellationToken)
    {
        using var response = await clients.CreateClient("upstream")
            .GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonDocument>(cancellationToken: cancellationToken)
            ?? throw new ProviderException("Account provider returned an empty response.");
    }

    private static string ReadSessionCookies(HttpResponseMessage response)
    {
        if (!response.Headers.TryGetValues("Set-Cookie", out var values))
            return string.Empty;
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "dle_user_id", "dle_password", "dle_hash", "dle_forum_sessions",
        };
        return string.Join("; ", values.Select(value => value.Split(';', 2)[0])
            .Select(value => value.Split('=', 2))
            .Where(parts => parts.Length == 2 && allowed.Contains(parts[0].Trim()))
            .Select(parts => $"{parts[0].Trim()}={parts[1].Trim()}"));
    }

    private static string RequiredString(JsonElement element, string name)
    {
        if (element.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String &&
            !string.IsNullOrWhiteSpace(property.GetString()))
            return property.GetString()!;
        throw new ProviderException("Account provider returned an incomplete response.");
    }

    private static int? OptionalInt(JsonElement element, string name) =>
        element.TryGetProperty(name, out var property) && property.TryGetInt32(out var value) ? value : null;
}
