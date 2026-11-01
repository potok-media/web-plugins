using System.Globalization;
using System.Net.Http.Headers;
using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers.Providers;

public sealed class AllohaProvider(HttpClient http, IMemoryCache? cache = null)
    : ProviderBase(http, cache), IOnlineProvider
{
    private const string ApiHost = "https://apbugall.org/v2";
    private const string LinkHost = "https://torso-as.stloadi.live";

    public string Id => "alloha";
    public string Name => "Alloha";
    public ProviderDescriptor Descriptor => new(Id, Name, "general", "account", "tokens");

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken) =>
        throw new ProviderException("An account is required for provider 'alloha'.");

    public Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken) =>
        throw new ProviderException("An account is required for provider 'alloha'.");

    public Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken) =>
        throw new ProviderException("An account is required for provider 'alloha'.");

    public async Task<IReadOnlyList<SourceItem>> SearchAsync(
        MediaQuery query,
        ProviderRequestContext context,
        CancellationToken cancellationToken)
    {
        var account = ReadAccount(context);
        try
        {
            if (!string.IsNullOrWhiteSpace(query.ImdbId) || query.KinopoiskId is > 0)
            {
                var root = await GetJsonAsync<ContentRoot>(AuthorizedGet(
                    $"{ApiHost}/movies/search?imdb={Uri.EscapeDataString(query.ImdbId ?? string.Empty)}&kp={query.KinopoiskId}",
                    account.ApiToken), cancellationToken);
                return root.Data is null ? [] : [MapSource(root.Data)];
            }

            var title = query.OriginalTitle ?? query.Title;
            if (string.IsNullOrWhiteSpace(title))
                return [];
            var list = await GetJsonAsync<SearchRoot>(AuthorizedGet(
                $"{ApiHost}/movies/name/list?name={Uri.EscapeDataString(title)}",
                account.ApiToken), cancellationToken);
            return (list.Data ?? []).Select(MapSource).ToArray();
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            throw new ProviderException("Alloha account request failed.");
        }
    }

    public async Task<EpisodesResult> GetEpisodesAsync(
        SourceSelection selection,
        ProviderRequestContext context,
        CancellationToken cancellationToken)
    {
        var account = ReadAccount(context);
        var media = await GetMediaAsync(selection.SourceId, account.ApiToken, cancellationToken);
        if (media.Category?.Slug is "movie" or "anime")
            return new EpisodesResult([], 0);
        var episodes = (media.Seasons ?? []).SelectMany(season => (season.Episodes ?? []).Select(episode =>
        {
            var audios = (episode.Translations ?? []).Select(translation =>
            {
                var locator = LocatorCodec.Encode(new AllohaLocator(
                    media.Token ?? selection.SourceId,
                    translation.Id,
                    season.Season,
                    episode.Episode,
                    translation.Quality,
                    translation.Name));
                return new AudioItem(
                    $"{Id}:{season.Season}:{episode.Episode}:{translation.Id}",
                    translation.Name ?? $"Перевод {translation.Id}",
                    locator);
            }).ToArray();
            if (audios.Length == 0)
                return null;
            return new EpisodeItem(
                Id: $"{Id}:{selection.SourceId}:{season.Season}:{episode.Episode}",
                Season: season.Season,
                Number: episode.Episode,
                Title: $"{episode.Episode} серия",
                Voice: audios[0].Name,
                Url: null,
                Audios: audios,
                Locator: audios[0].Locator);
        })).Where(item => item is not null).Cast<EpisodeItem>().ToArray();
        return new EpisodesResult(episodes, episodes.Length == 0 ? 0 : episodes.Max(item => item.Season));
    }

    public async Task<ResolvedPlayback> ResolveAsync(
        PlaybackSelection selection,
        ProviderRequestContext context,
        CancellationToken cancellationToken)
    {
        var account = ReadAccount(context);
        AllohaLocator locator;
        if (!string.IsNullOrWhiteSpace(selection.Locator))
        {
            locator = LocatorCodec.Decode<AllohaLocator>(selection.Locator);
        }
        else
        {
            var media = await GetMediaAsync(selection.SourceId, account.ApiToken, cancellationToken);
            var translation = media.Translations?.FirstOrDefault()
                ?? throw new ProviderException("Alloha did not return translations.");
            locator = new AllohaLocator(
                media.Token ?? selection.SourceId,
                translation.Id,
                selection.Season,
                selection.Episode is null ? null : (int)selection.Episode.Value,
                translation.Quality,
                translation.Name);
        }

        var url = $"{LinkHost}/direct?secret_token={Uri.EscapeDataString(account.SecretToken)}" +
            $"&token_movie={Uri.EscapeDataString(locator.MovieToken)}&translation={locator.TranslationId}";
        if (locator.Season is > 0)
            url += $"&season={locator.Season}";
        if (locator.Episode is > 0)
            url += $"&episode={locator.Episode}";

        try
        {
            var root = await GetJsonAsync<DirectRoot>(Get(url), cancellationToken);
            var qualities = root.Data?.File?.HlsSource?
                .OrderByDescending(item => item.Default)
                .SelectMany(item => item.Quality ?? [])
                .Where(item => !string.IsNullOrWhiteSpace(item.Value))
                .ToArray() ?? [];
            var selected = qualities.OrderByDescending(item => QualityNumber(item.Key)).FirstOrDefault();
            if (string.IsNullOrWhiteSpace(selected.Value))
                throw new ProviderException("Alloha did not return a playable stream.");
            return new ResolvedPlayback(
                ProviderParsing.AbsoluteHttps(selected.Value),
                selected.Key,
                locator.Voice);
        }
        catch (ProviderException)
        {
            throw;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            throw new ProviderException("Alloha playback request failed.");
        }
    }

    private static AllohaAccount ReadAccount(ProviderRequestContext context)
    {
        var values = context.RequireAccount("alloha", "apiToken", "secretToken", "label");
        if (!values.TryGetValue("apiToken", out var apiToken) || string.IsNullOrWhiteSpace(apiToken) ||
            !values.TryGetValue("secretToken", out var secretToken) || string.IsNullOrWhiteSpace(secretToken))
            throw new ProviderException("Alloha account is incomplete.");
        return new AllohaAccount(apiToken, secretToken);
    }

    private async Task<MediaItem> GetMediaAsync(
        string sourceId,
        string apiToken,
        CancellationToken cancellationToken)
    {
        var root = await GetJsonAsync<ContentRoot>(AuthorizedGet(
            $"{ApiHost}/movies/token/{Uri.EscapeDataString(sourceId)}",
            apiToken), cancellationToken);
        return root.Data ?? throw new ProviderException("Alloha source was not found.");
    }

    private static HttpRequestMessage AuthorizedGet(string url, string token)
    {
        var request = Get(url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return request;
    }

    private static SourceItem MapSource(MediaItem item) => new(
        "alloha",
        "Alloha",
        item.Token ?? throw new ProviderException("Alloha result has no token."),
        item.Name ?? item.OriginalName ?? "Alloha",
        item.OriginalName,
        item.Year,
        item.Poster,
        item.Flags?.Uhd == true ? "2160p" : item.Translations?.FirstOrDefault()?.Quality ?? "1080p",
        null,
        item.Category?.Slug is "movie" or "anime" ? "movie" : "tv");

    private static int QualityNumber(string? value)
    {
        var digits = new string((value ?? string.Empty).Where(char.IsDigit).ToArray());
        return int.TryParse(digits, NumberStyles.Integer, CultureInfo.InvariantCulture, out var result) ? result : 0;
    }

    private sealed record AllohaAccount(string ApiToken, string SecretToken);
    private sealed record AllohaLocator(
        string MovieToken,
        int TranslationId,
        int? Season,
        int? Episode,
        string? Quality,
        string? Voice);

    private sealed class ContentRoot { public MediaItem? Data { get; init; } }
    private sealed class SearchRoot { public List<MediaItem>? Data { get; init; } }
    private sealed class MediaItem
    {
        public string? Name { get; init; }
        public string? Original_Name { get; init; }
        public string? OriginalName => Original_Name;
        public int? Year { get; init; }
        public string? Token { get; init; }
        public string? Poster { get; init; }
        public Category? Category { get; init; }
        public List<Translation>? Translations { get; init; }
        public List<SeasonModel>? Seasons { get; init; }
        public Flags? Flags { get; init; }
    }
    private sealed class Category { public string? Slug { get; init; } }
    private sealed class Flags { public bool Uhd { get; init; } }
    private sealed class SeasonModel
    {
        public int Season { get; init; }
        public List<EpisodeModel>? Episodes { get; init; }
    }
    private sealed class EpisodeModel
    {
        public int Episode { get; init; }
        public List<Translation>? Translations { get; init; }
    }
    private sealed class Translation
    {
        public int Id { get; init; }
        public string? Name { get; init; }
        public string? Quality { get; init; }
        public bool Uhd { get; init; }
    }
    private sealed class DirectRoot { public DirectData? Data { get; init; } }
    private sealed class DirectData { public FileData? File { get; init; } }
    private sealed class FileData
    {
        public List<HlsSource>? HlsSource { get; init; }
    }
    private sealed class HlsSource
    {
        public bool Default { get; init; }
        public Dictionary<string, string>? Quality { get; init; }
    }
}
