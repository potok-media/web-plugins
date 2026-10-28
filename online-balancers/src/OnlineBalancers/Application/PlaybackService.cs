namespace OnlineBalancers;

public sealed class PlaybackService
{
    private readonly ProviderRegistry _registry;
    private readonly SignedTicketCodec _tickets;
    private readonly EncryptedTicketCodec _streamTickets;

    public PlaybackService(
        ProviderRegistry registry,
        SignedTicketCodec tickets,
        EncryptedTicketCodec? streamTickets = null)
    {
        _registry = registry;
        _tickets = tickets;
        _streamTickets = streamTickets ?? new EncryptedTicketCodec();
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
        return ResolveAsync(
            new PlaybackTicket(request.Provider, selection),
            request.Account,
            publicOrigin,
            cancellationToken);
    }

    public Task<PlaybackResponse> RefreshAsync(
        RefreshRequest request,
        string publicOrigin,
        CancellationToken cancellationToken) =>
        ResolveAsync(_tickets.Read<PlaybackTicket>(request.Session), request.Account, publicOrigin, cancellationToken);

    public Task<PlaybackResponse> ResolveTicketAsync(
        string token,
        string publicOrigin,
        CancellationToken cancellationToken) =>
        ResolveAsync(_tickets.Read<PlaybackTicket>(token), null, publicOrigin, cancellationToken);

    private async Task<PlaybackResponse> ResolveAsync(
        PlaybackTicket ticket,
        ProviderAccount? account,
        string publicOrigin,
        CancellationToken cancellationToken)
    {
        var provider = _registry.Get(ticket.Provider);
        var context = ProviderRequestContext.For(provider, account);
        var resolved = await provider.ResolveAsync(ticket.Selection, context, cancellationToken);
        var streamTicket = _streamTickets.Issue(new StreamTicket(resolved.Url, resolved.Headers), "stream");
        var streamType = resolved.Url.Contains(".m3u8", StringComparison.OrdinalIgnoreCase) ? "m3u8" : "mp4";
        var streamUrl = $"{publicOrigin}/stream/{streamTicket}.{streamType}";
        return new PlaybackResponse(
            streamUrl,
            streamType,
            resolved.Quality,
            resolved.Voice,
            _tickets.Issue(ticket));
    }
}
