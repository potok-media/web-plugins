namespace OnlineBalancers;

public sealed class PlaybackService
{
    private readonly ProviderRegistry _registry;
    private readonly StreamTicketService _streamTickets;

    public PlaybackService(ProviderRegistry registry, StreamTicketService streamTickets)
    {
        _registry = registry;
        _streamTickets = streamTickets;
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
        return ResolveAsync(selection, request.Account, request.Provider, publicOrigin, cancellationToken);
    }

    private async Task<PlaybackResponse> ResolveAsync(
        PlaybackSelection selection,
        ProviderAccount? account,
        string providerId,
        string publicOrigin,
        CancellationToken cancellationToken)
    {
        var provider = _registry.Get(providerId);
        var context = ProviderRequestContext.For(provider, account);
        var resolved = await provider.ResolveAsync(selection, context, cancellationToken);
        var streamType = resolved.Url.Contains(".m3u8", StringComparison.OrdinalIgnoreCase) ? "m3u8" : "mp4";
        var streamUrl = _streamTickets.Issue(publicOrigin, resolved.Url, resolved.Headers);
        var variants = resolved.Variants?
            .Select(variant => new PlaybackVariant(
                _streamTickets.Issue(publicOrigin, variant.Url, resolved.Headers)))
            .ToArray();
        return new PlaybackResponse(
            streamUrl,
            streamType,
            resolved.Quality,
            resolved.Voice,
            null,
            variants);
    }
}
