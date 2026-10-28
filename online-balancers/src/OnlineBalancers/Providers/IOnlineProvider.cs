namespace OnlineBalancers;

public interface IOnlineProvider
{
    string Id { get; }
    string Name { get; }
    ProviderDescriptor Descriptor => new(Id, Name);
    Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken);
    Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken);
    Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken);

    Task<IReadOnlyList<SourceItem>> SearchAsync(
        MediaQuery query,
        ProviderRequestContext context,
        CancellationToken cancellationToken) => SearchAsync(query, cancellationToken);

    Task<EpisodesResult> GetEpisodesAsync(
        SourceSelection selection,
        ProviderRequestContext context,
        CancellationToken cancellationToken) => GetEpisodesAsync(selection, cancellationToken);

    Task<ResolvedPlayback> ResolveAsync(
        PlaybackSelection selection,
        ProviderRequestContext context,
        CancellationToken cancellationToken) => ResolveAsync(selection, cancellationToken);
}

public sealed class ProviderException(string message) : Exception(message);
