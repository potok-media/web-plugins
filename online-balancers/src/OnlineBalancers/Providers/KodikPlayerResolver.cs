using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace OnlineBalancers.Providers;

public sealed partial class KodikPlayerResolver(HttpClient http)
{
    public async Task<IReadOnlyList<KodikPlayerStream>> ResolveAsync(
        string playerLink,
        string referer,
        CancellationToken cancellationToken)
    {
        var absoluteLink = ProviderParsing.AbsoluteHttps(playerLink);
        if (!Uri.TryCreate(absoluteLink, UriKind.Absolute, out var playerUri) ||
            !playerUri.Host.Contains("kodik", StringComparison.OrdinalIgnoreCase))
            throw new ProviderException("Kodik returned an unexpected player host.");

        var iframe = await SendStringAsync(HttpMethod.Get, absoluteLink, referer, null, cancellationToken);
        var script = PlayerScriptRegex().Match(iframe).Groups[1].Value;
        var domain = JavaScriptValue(iframe, "domain");
        var domainSign = JavaScriptValue(iframe, "d_sign");
        var playerDomain = JavaScriptValue(iframe, "pd");
        var playerDomainSign = JavaScriptValue(iframe, "pd_sign");
        var refDomain = JavaScriptValue(iframe, "ref");
        var refSign = JavaScriptValue(iframe, "ref_sign");
        var type = JavaScriptValue(iframe, "vInfo.type");
        var hash = JavaScriptValue(iframe, "vInfo.hash");
        var id = JavaScriptValue(iframe, "vInfo.id");
        if (string.IsNullOrWhiteSpace(script) || string.IsNullOrWhiteSpace(domain))
            throw new ProviderException("Kodik player settings were not found.");

        var playerOrigin = new Uri($"{playerUri.Scheme}://{playerUri.Authority}");
        var scriptUrl = new Uri(playerOrigin, script).ToString();
        var playerScript = await SendStringAsync(HttpMethod.Get, scriptUrl, absoluteLink, null, cancellationToken);
        var endpoint = DecodeBase64Url(EndpointRegex().Match(playerScript).Groups[1].Value);
        if (string.IsNullOrWhiteSpace(endpoint) || !endpoint.StartsWith("/", StringComparison.Ordinal))
            throw new ProviderException("Kodik player endpoint is invalid.");

        var form = new Dictionary<string, string>
        {
            ["d"] = domain,
            ["d_sign"] = domainSign,
            ["pd"] = playerDomain,
            ["pd_sign"] = playerDomainSign,
            ["ref"] = refDomain,
            ["ref_sign"] = refSign,
            ["bad_user"] = "false",
            ["cdn_is_working"] = "true",
            ["type"] = type,
            ["hash"] = hash,
            ["id"] = id,
            ["info"] = "{}",
        };
        var json = await SendStringAsync(
            HttpMethod.Post,
            new Uri(playerOrigin, endpoint).ToString(),
            absoluteLink,
            new FormUrlEncodedContent(form),
            cancellationToken);

        var streams = new List<KodikPlayerStream>();
        foreach (Match match in StreamRegex().Matches(json))
        {
            if (!int.TryParse(match.Groups[1].Value, out var height))
                continue;
            var escaped = match.Groups[2].Value;
            string source;
            try
            {
                source = JsonSerializer.Deserialize<string>($"\"{escaped}\"") ?? escaped;
            }
            catch (JsonException)
            {
                source = escaped;
            }

            if (!source.Contains("manifest.m3u8", StringComparison.OrdinalIgnoreCase) &&
                !source.StartsWith("http", StringComparison.OrdinalIgnoreCase) &&
                !source.StartsWith("//", StringComparison.Ordinal))
                source = DecodeBase64Url(RotateLetters(source, 18));
            if (!string.IsNullOrWhiteSpace(source))
                streams.Add(new KodikPlayerStream(height, ProviderParsing.AbsoluteHttps(source)));
        }
        return streams;
    }

    private async Task<string> SendStringAsync(
        HttpMethod method,
        string url,
        string referer,
        HttpContent? content,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, url) { Content = content };
        request.Headers.Referrer = new Uri(referer);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new ProviderException(
                $"Kodik request failed: {(int)response.StatusCode} {response.ReasonPhrase} " +
                $"for {method.Method} {url}; body: {Truncate(body, 300)}");
        }
        return await response.Content.ReadAsStringAsync(cancellationToken);
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max] + "…";

    private static string JavaScriptValue(string input, string name) => Regex.Match(
        input,
        $"(?:^|[;\\s])(?:var\\s+)?{Regex.Escape(name)}\\s*=\\s*['\"]([^'\"]+)['\"]",
        RegexOptions.IgnoreCase).Groups[1].Value;

    private static string RotateLetters(string value, int shift) => Regex.Replace(value, "[a-zA-Z]", match =>
    {
        var character = match.Value[0];
        var start = char.IsUpper(character) ? 'A' : 'a';
        return ((char)(start + (character - start + shift) % 26)).ToString();
    });

    private static string DecodeBase64Url(string value)
    {
        try
        {
            return Encoding.UTF8.GetString(Base64Url.Decode(value));
        }
        catch (FormatException)
        {
            return string.Empty;
        }
    }

    [GeneratedRegex("src=['\"]([^'\"]*/assets/js/app\\.player[^'\"]+\\.js)['\"]", RegexOptions.IgnoreCase)]
    private static partial Regex PlayerScriptRegex();

    [GeneratedRegex("type\\s*:\\s*['\"]POST['\"]\\s*,\\s*url\\s*:\\s*atob\\(['\"]([^'\"]+)['\"]\\)", RegexOptions.IgnoreCase)]
    private static partial Regex EndpointRegex();

    [GeneratedRegex("\"([0-9]+)p?\"\\s*:\\s*\\[\\s*\\{\\s*\"src\"\\s*:\\s*\"((?:\\\\.|[^\"])*)", RegexOptions.IgnoreCase)]
    private static partial Regex StreamRegex();
}

public sealed record KodikPlayerStream(int Height, string Url);
