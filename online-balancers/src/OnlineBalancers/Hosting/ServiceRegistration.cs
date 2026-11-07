using System.Net;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using OnlineBalancers.Providers;

namespace OnlineBalancers;

public static class ServiceRegistration
{
    public static IServiceCollection AddOnlineBalancers(this IServiceCollection services)
    {
        services.AddMemoryCache();
        services.AddCors(options => options.AddDefaultPolicy(policy => policy
            .SetIsOriginAllowed(_ => true)
            .AllowAnyMethod()
            .AllowAnyHeader()
            .AllowCredentials()));
        services.AddHttpClient("upstream", client =>
        {
            client.Timeout = TimeSpan.FromSeconds(20);
            client.DefaultRequestHeaders.UserAgent.ParseAdd(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36");
        }).ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
        {
            AutomaticDecompression = DecompressionMethods.All,
            AllowAutoRedirect = true,
            UseCookies = false,
            ConnectTimeout = TimeSpan.FromSeconds(8),
            PooledConnectionLifetime = TimeSpan.FromMinutes(10),
        });

        foreach (var providerType in DiscoverProviderTypes())
        {
            var implementationType = providerType;
            services.AddSingleton(typeof(IOnlineProvider), serviceProvider =>
            {
                var http = serviceProvider
                    .GetRequiredService<IHttpClientFactory>()
                    .CreateClient("upstream");
                var inner = (IOnlineProvider)ActivatorUtilities.CreateInstance(
                    serviceProvider,
                    implementationType,
                    http,
                    serviceProvider.GetRequiredService<IMemoryCache>());
                // Failure-only structured logging around every provider call (see the
                // decorator): diagnostics in docker logs without changing API behavior.
                return new LoggingOnlineProvider(
                    inner,
                    inner.Id,
                    serviceProvider.GetRequiredService<ILogger<LoggingOnlineProvider>>());
            });
        }

        services.AddSingleton<ProviderRegistry>();
        services.AddSingleton<ProviderSearchCoordinator>();
        services.AddSingleton<EpisodeService>();
        services.AddSingleton<PlaybackService>();
        services.AddSingleton<AccountConnectionService>();
        return services;
    }

    private static IReadOnlyList<Type> DiscoverProviderTypes() => typeof(IOnlineProvider).Assembly
        .GetTypes()
        .Where(type => typeof(IOnlineProvider).IsAssignableFrom(type) && type is { IsClass: true, IsAbstract: false })
        // The logging decorator is applied by the registration loop itself — it must never
        // be discovered as a provider implementation.
        .Where(type => type != typeof(LoggingOnlineProvider))
        .OrderBy(type => type.FullName, StringComparer.Ordinal)
        .ToArray();
}
