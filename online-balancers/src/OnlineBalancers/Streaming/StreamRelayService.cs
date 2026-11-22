using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace OnlineBalancers;

public sealed partial class StreamRelayService(
    IHttpClientFactory clients,
    StreamTicketService tickets)
{
    public async Task RelayAsync(
        string token,
        HttpRequest incoming,
        HttpResponse outgoing,
        CancellationToken cancellationToken)
    {
        if (!tickets.TryGet(token, out var ticket) || ticket is null)
        {
            outgoing.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, ticket.Target);
        CopyRequestHeader(incoming, request, "Range");
        CopyRequestHeader(incoming, request, "If-None-Match");
        CopyRequestHeader(incoming, request, "If-Modified-Since");
        foreach (var (name, value) in ticket.Headers)
            request.Headers.TryAddWithoutValidation(name, value);

        using var response = await clients.CreateClient("stream").SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        outgoing.StatusCode = (int)response.StatusCode;
        CopyResponseHeader(response, outgoing, "Accept-Ranges");
        CopyResponseHeader(response, outgoing, "Cache-Control");
        CopyResponseHeader(response, outgoing, "Content-Range");
        CopyResponseHeader(response, outgoing, "ETag");
        CopyResponseHeader(response, outgoing, "Last-Modified");

        var mediaType = response.Content.Headers.ContentType?.MediaType;
        var isManifest = IsManifest(ticket.Target, mediaType);
        if (!isManifest)
        {
            if (response.Content.Headers.ContentType is not null)
                outgoing.ContentType = response.Content.Headers.ContentType.ToString();
            if (response.Content.Headers.ContentLength is { } contentLength)
                outgoing.ContentLength = contentLength;
            await response.Content.CopyToAsync(outgoing.Body, cancellationToken);
            return;
        }

        var manifest = await response.Content.ReadAsStringAsync(cancellationToken);
        var rewritten = RewriteManifest(
            manifest,
            ticket.Target,
            ticket.Headers,
            PublicUrl.Origin(incoming));
        outgoing.ContentType = "application/vnd.apple.mpegurl";
        var bytes = Encoding.UTF8.GetBytes(rewritten);
        outgoing.ContentLength = bytes.Length;
        await outgoing.Body.WriteAsync(bytes, cancellationToken);
    }

    internal string RewriteManifest(
        string manifest,
        Uri manifestUrl,
        IReadOnlyDictionary<string, string> headers,
        string publicOrigin)
    {
        var lines = manifest.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n');
        for (var index = 0; index < lines.Length; index++)
        {
            var line = lines[index];
            if (line.Length == 0)
                continue;

            if (!line.StartsWith('#'))
            {
                lines[index] = RelayUrl(line.Trim(), manifestUrl, headers, publicOrigin);
                continue;
            }

            lines[index] = UriAttributeRegex().Replace(line, match =>
                $"URI=\"{RelayUrl(match.Groups[1].Value, manifestUrl, headers, publicOrigin)}\"");
        }
        return string.Join('\n', lines);
    }

    private string RelayUrl(
        string value,
        Uri manifestUrl,
        IReadOnlyDictionary<string, string> headers,
        string publicOrigin)
    {
        if (!Uri.TryCreate(manifestUrl, value, out var absolute) ||
            absolute.Scheme is not ("http" or "https"))
            return value;
        return tickets.Issue(publicOrigin, absolute.AbsoluteUri, headers);
    }

    private static bool IsManifest(Uri uri, string? mediaType) =>
        uri.AbsolutePath.Contains(".m3u8", StringComparison.OrdinalIgnoreCase) ||
        mediaType?.Contains("mpegurl", StringComparison.OrdinalIgnoreCase) == true;

    private static void CopyRequestHeader(
        HttpRequest incoming,
        HttpRequestMessage outgoing,
        string name)
    {
        if (incoming.Headers.TryGetValue(name, out var value))
            outgoing.Headers.TryAddWithoutValidation(name, value.ToArray());
    }

    private static void CopyResponseHeader(
        HttpResponseMessage incoming,
        HttpResponse outgoing,
        string name)
    {
        if (incoming.Headers.TryGetValues(name, out var values) ||
            incoming.Content.Headers.TryGetValues(name, out values))
            outgoing.Headers[name] = values.ToArray();
    }

    [GeneratedRegex("URI=\"([^\"]+)\"", RegexOptions.IgnoreCase)]
    private static partial Regex UriAttributeRegex();
}
