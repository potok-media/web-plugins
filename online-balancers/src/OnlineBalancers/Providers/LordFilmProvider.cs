using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers.Providers;

/// <summary>
/// LordFilm (gv.lordfilm5.pro) — RU movies/series via the nextembed.ws player, ported from
/// the lampac LordFilm module. DLE search on /search-result/, the embed id from the title
/// page, and the player's JS config: <c>source:</c> for movies (hls ~530p / dash up to
/// 1080p) or <c>playlist:</c> with a seasons JSON for series. Streams are served from the
/// interkh CDN with the nextembed Referer. Not reproduced from lampac: the master-manifest
/// rewriting that renames technical track ids (rus0 → voice names) and the DASH segment
/// proxy — voice naming stays technical and segments load directly from the CDN.
/// </summary>
public sealed class LordFilmProvider(HttpClient http, IMemoryCache? cache = null)
    : ProviderBase(http, cache), IOnlineProvider
{
    private const string Host = "https://gv.lordfilm5.pro";
    private const string PlayerHost = "https://api.nextembed.ws";
    private const string Referer = "https://api.nextembed.ws/";

    public string Id => "lordfilm";
    public string Name => "LordFilm";
    public ProviderDescriptor Descriptor => new(Id, Name, "movies", Slow: true);

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        var title = query.Title ?? query.OriginalTitle;
        if (string.IsNullOrWhiteSpace(title))
            return Task.FromResult<IReadOnlyList<SourceItem>>([]);

        return CachedAsync<IReadOnlyList<SourceItem>>(
            $"lordfilm:search:{title}",
            TimeSpan.FromHours(4),
            async () =>
            {
                var html = await PostSearchAsync(title, cancellationToken);
                if (string.IsNullOrEmpty(html))
                    html = await PostSearchAsync(title, cancellationToken);
                if (string.IsNullOrEmpty(html))
                    return [];

                var mediaType = string.Equals(query.Type, "movie", StringComparison.OrdinalIgnoreCase) ? "movie" : "tv";
                var items = new List<SourceItem>();
                foreach (var block in Regex.Split(html, "<div class=\"th-item\">").Skip(1))
                {
                    var href = Regex.Match(block, "class=\"th-in[^\"]*\"\\s+href=\"(https?://[^\"]+)\"");
                    if (!href.Success)
                        continue;
                    var name = Regex.Match(block, "class=\"th-title\">([^<]*)</div>");
                    var year = Regex.Match(block, "class=\"th-series\">([^<]*)</div>");
                    var poster = Regex.Match(block, "<img[^>]+src=\"([^\"]+)\"");
                    items.Add(new SourceItem(
                        Id,
                        Name,
                        href.Groups[1].Value,
                        Decode(name.Groups[1].Value),
                        null,
                        int.TryParse(Regex.Match(year.Groups[1].Value, "(\\d{4})").Groups[1].Value, out var y) && y > 0 ? y : null,
                        poster.Success ? poster.Groups[1].Value : null,
                        string.Empty,
                        null,
                        mediaType));
                }
                return (IReadOnlyList<SourceItem>)items;
            });
    }

    public async Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken)
    {
        var embed = await LoadEmbedAsync(selection.SourceId, cancellationToken)
            ?? throw new ProviderException("LordFilm did not return the title's embed data.");

        if (embed.Movie is not null)
        {
            var locator = LocatorCodec.Encode(new LordFilmLocator(embed.Movie.Hls, embed.Movie.Dash));
            return new EpisodesResult(
                [new EpisodeItem(
                    $"{Id}:{selection.SourceId}:movie",
                    1,
                    1,
                    "Фильм",
                    null,
                    null,
                    [new AudioItem($"{Id}:movie:0", "Основной поток", locator)],
                    locator)],
                1);
        }

        var episodes = new List<EpisodeItem>();
        foreach (var season in embed.Seasons)
        {
            if (season.Blocked)
                continue;
            foreach (var episode in season.Episodes)
            {
                var number = double.TryParse(episode.Episode, System.Globalization.CultureInfo.InvariantCulture, out var parsed)
                    ? parsed
                    : episodes.Count + 1;
                var locator = LocatorCodec.Encode(new LordFilmLocator(episode.Hls, episode.Dasha ?? episode.Dash));
                episodes.Add(new EpisodeItem(
                    $"{Id}:{selection.SourceId}:{season.Season}:{number:g}",
                    season.Season,
                    number,
                    $"{number:g} серия",
                    episode.Audio?.Name,
                    null,
                    [new AudioItem($"{Id}:{season.Season}:{number:g}:0", episode.Audio?.Name ?? "Основной поток", locator)],
                    locator));
            }
        }
        return new EpisodesResult(
            episodes,
            embed.Seasons.Select(season => season.Season).DefaultIfEmpty(1).Max());
    }

    public Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken)
    {
        var locator = string.IsNullOrWhiteSpace(selection.Locator)
            ? throw new ProviderException("LordFilm playback locator is missing.")
            : LocatorCodec.Decode<LordFilmLocator>(selection.Locator);
        // DASH carries up to 1080p; HLS of this player tops out around 530p.
        if (!string.IsNullOrWhiteSpace(locator.Dash))
            return Task.FromResult(new ResolvedPlayback(locator.Dash, "1080p", selection.Voice,
                new Dictionary<string, string> { ["Referer"] = Referer }));
        if (!string.IsNullOrWhiteSpace(locator.Hls))
            return Task.FromResult(new ResolvedPlayback(locator.Hls, "720p", selection.Voice,
                new Dictionary<string, string> { ["Referer"] = Referer }));
        throw new ProviderException("LordFilm did not return a playable stream.");
    }

    private async Task<string?> PostSearchAsync(string title, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{Host}/search-result/")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["do"] = "search",
                ["subaction"] = "search",
                ["story"] = title,
            }),
        };
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
            return null;
        return await response.Content.ReadAsStringAsync(cancellationToken);
    }

    private Task<LordFilmEmbed?> LoadEmbedAsync(string pageUri, CancellationToken cancellationToken) =>
        CachedAsync(
            $"lordfilm:view:{pageUri}",
            TimeSpan.FromMinutes(20),
            async () =>
            {
                var page = await GetStringAsync(Get(pageUri), cancellationToken);
                var id = Regex.Match(page, "//api\\.nextembed\\.ws/embed/(?:movie|serial|embed)/([0-9]+)", RegexOptions.IgnoreCase);
                if (!id.Success)
                    return null;
                var embed = await GetStringAsync(Get($"{PlayerHost}/embed/movie/{id.Groups[1].Value}"), cancellationToken);
                return ParseEmbed(embed);
            });

    private static LordFilmEmbed? ParseEmbed(string html)
    {
        if (html.Contains("playlist:", StringComparison.Ordinal))
        {
            var seasons = ParseSeasons(html);
            return seasons is { Count: > 0 } ? new LordFilmEmbed(null, seasons) : null;
        }
        if (html.Contains("source:", StringComparison.Ordinal))
        {
            var movie = ParseMovieSource(html);
            return movie is null ? null : new LordFilmEmbed(movie, []);
        }
        return null;
    }

    private static LordFilmMovie? ParseMovieSource(string html)
    {
        var start = html.IndexOf("source:", StringComparison.Ordinal);
        if (start < 0)
            return null;
        var open = html.IndexOf('{', start);
        var block = open < 0 ? html[start..] : Balanced(html, open, '{', '}');
        return new LordFilmMovie(Url(block, "hls"), Url(block, "dasha") ?? Url(block, "dash"));
    }

    private static IReadOnlyList<LordFilmSeason>? ParseSeasons(string html)
    {
        var start = html.IndexOf("playlist:", StringComparison.Ordinal);
        var marker = start < 0 ? -1 : html.IndexOf("seasons:", start, StringComparison.Ordinal);
        if (marker < 0)
            return null;
        var open = html.IndexOf('[', marker);
        if (open < 0)
            return null;
        var json = Balanced(html, open, '[', ']');
        if (json is null)
            return null;
        try
        {
            return JsonSerializer.Deserialize<IReadOnlyList<LordFilmSeason>>(json, SerializerOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? Balanced(string text, int openIndex, char open, char close)
    {
        var depth = 0;
        for (var i = openIndex; i < text.Length; i++)
        {
            if (text[i] == open) depth++;
            else if (text[i] == close && --depth == 0)
                return text.Substring(openIndex + 1, i - openIndex - 1);
        }
        return null;
    }

    private static string? Url(string block, string key)
    {
        var match = Regex.Match(block, $"{key}:\\s*\"([^\"]+)\"");
        return match.Success ? match.Groups[1].Value : null;
    }

    private static string Decode(string value) =>
        value.Replace("&amp;", "&").Replace("&quot;", "\"").Replace("&#039;", "'").Replace("&nbsp;", " ");

    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    private sealed record LordFilmLocator(string? Hls, string? Dash);

    private sealed record LordFilmEmbed(LordFilmMovie? Movie, IReadOnlyList<LordFilmSeason> Seasons);

    private sealed record LordFilmMovie([property: JsonPropertyName("hls")] string? Hls, [property: JsonPropertyName("dash")] string? Dash);

    private sealed record LordFilmSeason(
        [property: JsonPropertyName("season")] int Season,
        [property: JsonPropertyName("blocked")] bool Blocked,
        [property: JsonPropertyName("episodes")] LordFilmEpisode[] Episodes);

    private sealed record LordFilmEpisode(
        [property: JsonPropertyName("episode")] string Episode,
        [property: JsonPropertyName("hls")] string? Hls,
        [property: JsonPropertyName("dasha")] string? Dasha,
        [property: JsonPropertyName("dash")] string? Dash,
        [property: JsonPropertyName("audio")] LordFilmAudio? Audio);

    private sealed record LordFilmAudio([property: JsonPropertyName("name")] string? Name);
}
