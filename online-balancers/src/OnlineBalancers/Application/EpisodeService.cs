namespace OnlineBalancers;

public sealed class EpisodeService(ProviderRegistry registry)
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
        var episodes = result.Episodes.Select(episode =>
            episode with
            {
                Url = null,
                Audios = episode.Audios.Select(audio => audio with { Url = null }).ToArray(),
            }).ToArray();
        return new EpisodesResult(episodes, result.SeasonsCount);
    }
}
