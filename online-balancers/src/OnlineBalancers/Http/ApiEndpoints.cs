using System.Text.Json;
namespace OnlineBalancers;

public static class ApiEndpoints
{
    // camelCase NDJSON keys — the plugin client matches chunk.type etc.
    private static readonly JsonSerializerOptions StreamJson = new(JsonSerializerDefaults.Web);

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
            HttpResponse response,
            CancellationToken cancellationToken) =>
        {
            // Streaming search: one NDJSON line per finished provider (result or soft
            // error), then a final "done" chunk with the full ranked response. Chunked
            // writes flush per line so the client draws results as they land.
            response.ContentType = "application/x-ndjson; charset=utf-8";
            var writeLock = new SemaphoreSlim(1, 1);
            var final = await coordinator.SearchStreamingAsync(
                request.Query,
                request.Providers,
                request.Accounts ??
                    (request.Account is null
                        ? null
                        : new Dictionary<string, ProviderAccount>(StringComparer.OrdinalIgnoreCase)
                        {
                            [request.Account.Provider] = request.Account,
                        }),
                async (chunk, chunkCt) =>
                {
                    // Kestrel forbids synchronous IO (StreamWriter.AutoFlush would Flush()
                    // sync) — WriteAsync goes out as one HTTP chunk per NDJSON line.
                    await writeLock.WaitAsync(chunkCt);
                    try
                    {
                        await response.WriteAsync(
                            JsonSerializer.Serialize(chunk, StreamJson) + "\n", chunkCt);
                    }
                    catch (IOException)
                    {
                        // Client went away mid-stream — nothing more to send to.
                    }
                    finally
                    {
                        writeLock.Release();
                    }
                },
                cancellationToken);
            await writeLock.WaitAsync(cancellationToken);
            try
            {
                await response.WriteAsync(
                    JsonSerializer.Serialize(new SearchDoneChunk("done", final), StreamJson) + "\n",
                    cancellationToken);
            }
            finally
            {
                writeLock.Release();
            }
        });

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

        endpoints.MapPost("/api/v1/accounts/filmix/device/start", async (
            AccountConnectionService accounts,
            CancellationToken cancellationToken) => await HandleAsync(async () =>
                Results.Ok(await accounts.StartFilmixAsync(cancellationToken))));

        endpoints.MapPost("/api/v1/accounts/filmix/device/poll", async (
            KinoPubDevicePollRequest request,
            AccountConnectionService accounts,
            CancellationToken cancellationToken) => await HandleAsync(async () =>
                Results.Ok(await accounts.PollFilmixAsync(request, cancellationToken))));

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
