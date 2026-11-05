using System.Net;
using Microsoft.Extensions.Caching.Memory;

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
                return (IOnlineProvider)ActivatorUtilities.CreateInstance(
                    serviceProvider,
                    implementationType,
                    http,
                    serviceProvider.GetRequiredService<IMemoryCache>());
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
        .OrderBy(type => type.FullName, StringComparer.Ordinal)
        .ToArray();
}
