namespace OnlineBalancers;

public sealed class EpisodeService(ProviderRegistry registry, SignedTicketCodec tickets)
{
    public async Task<EpisodesResult> GetEpisodesAsync(
        EpisodesRequest request,
        string publicOrigin,
        CancellationToken cancellationToken)
    {
        var provider = registry.Get(request.Provider);
        var context = ProviderRequestContext.For(provider, request.Account);
        var result = await provider.GetEpisodesAsync(
            new SourceSelection(request.SourceId, request.Query),
            context,
            cancellationToken);
        var episodes = result.Episodes.Select(episode => episode with
        {
            Audios = episode.Audios.Select(audio =>
            {
                var selection = new PlaybackSelection(
                    request.SourceId,
                    request.Query,
                    episode.Season,
                    episode.Number,
                    audio.Name,
                    audio.Locator);
                if (provider.Descriptor.RequiresAccount)
                    return audio with { Url = null };
                var token = tickets.Issue(new PlaybackTicket(provider.Id, selection));
                return audio with { Url = $"{publicOrigin}/api/v1/audio/{token}" };
            }).ToArray(),
        }).ToArray();
        return new EpisodesResult(episodes, result.SeasonsCount);
    }
}
