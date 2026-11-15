namespace OnlineBalancers;

public sealed class PlaybackService
{
    private readonly ProviderRegistry _registry;

    public PlaybackService(ProviderRegistry registry)
    {
        _registry = registry;
    }

    public Task<PlaybackResponse> ResolveAsync(
        PlaybackRequest request,
        string publicOrigin,
        CancellationToken cancellationToken)
    {
        var selection = new PlaybackSelection(
            request.SourceId,
            request.Query,
            request.Season,
            request.Episode,
            request.Voice,
            request.Locator);
        return ResolveAsync(selection, request.Account, request.Provider, cancellationToken);
    }

    private async Task<PlaybackResponse> ResolveAsync(
        PlaybackSelection selection,
        ProviderAccount? account,
        string providerId,
        CancellationToken cancellationToken)
    {
        var provider = _registry.Get(providerId);
        var context = ProviderRequestContext.For(provider, account);
        var resolved = await provider.ResolveAsync(selection, context, cancellationToken);
        var streamType = resolved.Url.Contains(".m3u8", StringComparison.OrdinalIgnoreCase) ? "m3u8" : "mp4";
        return new PlaybackResponse(
            resolved.Url,
            streamType,
            resolved.Quality,
            resolved.Voice,
            resolved.Headers);
    }
}
