using Microsoft.AspNetCore.Http.Extensions;

namespace OnlineBalancers;

public static class PublicUrl
{
    public static string Origin(HttpRequest request)
    {
        var forwardedScheme = FirstHeader(request, "X-Forwarded-Proto");
        var scheme = forwardedScheme is "http" or "https" ? forwardedScheme : request.Scheme;
        var forwardedHost = FirstHeader(request, "X-Forwarded-Host");
        var hostValue = string.IsNullOrWhiteSpace(forwardedHost) ? request.Host.Value : forwardedHost;
        var host = HostString.FromUriComponent(hostValue ?? "localhost");
        return UriHelper.BuildAbsolute(scheme, host).TrimEnd('/');
    }

    private static string? FirstHeader(HttpRequest request, string name) => request.Headers.TryGetValue(name, out var values)
        ? values.ToString().Split(',', 2)[0].Trim()
        : null;
}
