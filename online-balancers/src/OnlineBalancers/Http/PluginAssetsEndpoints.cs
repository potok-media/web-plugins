namespace OnlineBalancers;

public static class PluginAssetsEndpoints
{
    private static readonly IReadOnlyDictionary<string, string> ContentTypes =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            [".css"] = "text/css; charset=utf-8",
            [".js"] = "text/javascript; charset=utf-8",
            [".json"] = "application/json; charset=utf-8",
            [".map"] = "application/json; charset=utf-8",
        };

    public static IEndpointRouteBuilder MapPluginAssets(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/plugin/{**assetPath}", (string? assetPath) => ResolveAsset(assetPath));
        return endpoints;
    }

    internal static IResult ResolveAsset(string? assetPath)
    {
        var pluginRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "plugin"));
        var requestedPath = ResolveAssetPath(pluginRoot, assetPath);
        if (requestedPath is null)
            return Results.NotFound();

        return Results.File(requestedPath, ContentTypeFor(requestedPath));
    }

    internal static string? ResolveAssetPath(string pluginRoot, string? assetPath)
    {
        if (string.IsNullOrWhiteSpace(assetPath))
            return null;

        pluginRoot = Path.GetFullPath(pluginRoot);
        var requestedPath = Path.GetFullPath(Path.Combine(pluginRoot, assetPath.Replace('/', Path.DirectorySeparatorChar)));
        var requiredPrefix = pluginRoot.EndsWith(Path.DirectorySeparatorChar)
            ? pluginRoot
            : pluginRoot + Path.DirectorySeparatorChar;

        if (!requestedPath.StartsWith(requiredPrefix, StringComparison.Ordinal) || !File.Exists(requestedPath))
            return null;

        return requestedPath;
    }

    internal static string ContentTypeFor(string requestedPath) => ContentTypes.GetValueOrDefault(
            Path.GetExtension(requestedPath),
            "application/octet-stream");
}
