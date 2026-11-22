namespace OnlineBalancers;

public static class StreamEndpoints
{
    public static IEndpointRouteBuilder MapStreamRelay(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/stream/{token}", async (
            string token,
            HttpRequest request,
            HttpResponse response,
            StreamRelayService relay,
            CancellationToken cancellationToken) =>
        {
            await relay.RelayAsync(token, request, response, cancellationToken);
        });
        return endpoints;
    }
}
