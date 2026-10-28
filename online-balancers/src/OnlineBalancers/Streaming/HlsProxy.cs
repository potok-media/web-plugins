using System.Text;
using System.Text.RegularExpressions;

namespace OnlineBalancers;

public sealed partial class HlsProxy(HttpClient http, EncryptedTicketCodec tickets)
{
    public async Task ProxyAsync(HttpContext context, string token, CancellationToken cancellationToken)
    {
        var ticket = tickets.Read<StreamTicket>(token, "stream");
        if (!Uri.TryCreate(ticket.Url, UriKind.Absolute, out var upstreamUri) || upstreamUri.Scheme is not ("http" or "https"))
            throw new ProviderException("Stream URL is invalid.");

        using var request = new HttpRequestMessage(HttpMethod.Get, upstreamUri);
        if (context.Request.Headers.TryGetValue("Range", out var range))
            request.Headers.TryAddWithoutValidation("Range", range.ToString());
        if (ticket.Headers is not null)
        {
            foreach (var header in ticket.Headers)
                request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }

        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        var effectiveUri = response.RequestMessage?.RequestUri ?? upstreamUri;
        var mediaType = response.Content.Headers.ContentType?.MediaType;
        var isManifest = effectiveUri.AbsolutePath.EndsWith(".m3u8", StringComparison.OrdinalIgnoreCase) ||
            mediaType?.Contains("mpegurl", StringComparison.OrdinalIgnoreCase) == true;

        context.Response.StatusCode = (int)response.StatusCode;
        context.Response.Headers.CacheControl = "no-store";
        if (isManifest && response.IsSuccessStatusCode)
        {
            var manifest = await response.Content.ReadAsStringAsync(cancellationToken);
            var rewritten = RewriteManifest(manifest, effectiveUri, ticket.Headers, context.Request);
            context.Response.ContentType = "application/vnd.apple.mpegurl";
            await context.Response.WriteAsync(rewritten, Encoding.UTF8, cancellationToken);
            return;
        }

        if (!string.IsNullOrWhiteSpace(mediaType))
            context.Response.ContentType = mediaType;
        CopyHeader(response, context, "Accept-Ranges");
        CopyHeader(response, context, "Content-Range");
        await response.Content.CopyToAsync(context.Response.Body, cancellationToken);
    }

    private string RewriteManifest(string manifest, Uri baseUri, IReadOnlyDictionary<string, string>? headers, HttpRequest request)
    {
        var lines = manifest.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n');
        for (var index = 0; index < lines.Length; index++)
        {
            var line = lines[index];
            if (string.IsNullOrWhiteSpace(line))
                continue;
            if (line.StartsWith('#'))
            {
                lines[index] = UriAttributeRegex().Replace(line, match => $"URI=\"{ProxyUrl(new Uri(baseUri, match.Groups[1].Value), headers, request)}\"");
                continue;
            }
            lines[index] = ProxyUrl(new Uri(baseUri, line.Trim()), headers, request);
        }
        return string.Join('\n', lines);
    }

    private string ProxyUrl(Uri uri, IReadOnlyDictionary<string, string>? headers, HttpRequest request)
    {
        var token = tickets.Issue(new StreamTicket(uri.ToString(), headers), "stream");
        return $"{PublicUrl.Origin(request)}/stream/{token}";
    }

    private static void CopyHeader(HttpResponseMessage source, HttpContext destination, string name)
    {
        if (source.Headers.TryGetValues(name, out var responseValues) || source.Content.Headers.TryGetValues(name, out responseValues))
            destination.Response.Headers[name] = responseValues.ToArray();
    }

    [GeneratedRegex("URI=\"([^\"]+)\"", RegexOptions.IgnoreCase)]
    private static partial Regex UriAttributeRegex();
}
