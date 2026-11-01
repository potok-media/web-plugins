namespace OnlineBalancers;

public static class ApiEndpoints
{
    public static IEndpointRouteBuilder MapOnlineBalancerApi(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/healthz", () => Results.Ok(new { status = "ok" }));
        endpoints.MapGet("/", (ProviderRegistry registry) => Results.Ok(new
        {
            service = "Potok Online Balancers",
            providers = registry.All.Select(provider => provider.Descriptor),
            plugin = "/plugin/manifest.json",
        }));

        endpoints.MapPost("/api/v1/search", async (
            SearchRequest request,
            ProviderSearchCoordinator coordinator,
            CancellationToken cancellationToken) =>
            Results.Ok(await coordinator.SearchAsync(
                request.Query,
                request.Providers,
                request.Account,
                cancellationToken)));

        endpoints.MapPost("/api/v1/episodes", async (
            EpisodesRequest request,
            HttpRequest httpRequest,
            EpisodeService episodes,
            CancellationToken cancellationToken) => await HandleAsync(async () =>
                Results.Ok(await episodes.GetEpisodesAsync(
                    request,
                    PublicUrl.Origin(httpRequest),
                    cancellationToken))));

        endpoints.MapPost("/api/v1/playback", async (
            PlaybackRequest request,
            HttpRequest httpRequest,
            PlaybackService playback,
            CancellationToken cancellationToken) => await HandleAsync(async () =>
                Results.Ok(await playback.ResolveAsync(
                    request,
                    PublicUrl.Origin(httpRequest),
                    cancellationToken))));

        endpoints.MapPost("/api/v1/accounts/kinopub/device/start", async (
            AccountConnectionService accounts,
            CancellationToken cancellationToken) => await HandleAsync(async () =>
                Results.Ok(await accounts.StartKinoPubAsync(cancellationToken))));

        endpoints.MapPost("/api/v1/accounts/kinopub/device/poll", async (
            KinoPubDevicePollRequest request,
            AccountConnectionService accounts,
            CancellationToken cancellationToken) => await HandleAsync(async () =>
                Results.Ok(await accounts.PollKinoPubAsync(request, cancellationToken))));

        endpoints.MapPost("/api/v1/accounts/rezka/login", async (
            RezkaLoginRequest request,
            AccountConnectionService accounts,
            CancellationToken cancellationToken) => await HandleAsync(async () =>
                Results.Ok(await accounts.LoginRezkaAsync(request, cancellationToken))));

        return endpoints;
    }

    private static async Task<IResult> HandleAsync(Func<Task<IResult>> operation)
    {
        try
        {
            return await operation();
        }
        catch (Exception exception) when (exception is ProviderException or HttpRequestException or TaskCanceledException)
        {
            return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
        }
    }
}
