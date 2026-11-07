using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;

namespace OnlineBalancers.Providers;

/// <summary>
/// AniDUB (online.anidub.com) — RU-dub anime, ported from the lampac AniDub module. DLE
/// search (seasons are separate pages, each its own search card), episodes from the shared
/// player's <c>PLAYER_CONTEXT</c> playlist or sibnet embeds on the title page.
///
/// Stream specifics preserved from lampac:
/// - The shared player's master playlist is User-Agent-signed: the required UA is returned
///   in the resolve headers (the host's stream ticket applies them upstream), alongside
///   Referer/Origin of the player node.
/// - cdnN.anivids.link nodes rotate per request and part of them is dead: the master is
///   re-fetched (up to 8 attempts) skipping known-dead nodes until a live one turns up.
/// - sibnet only serves video.sibnet.ru with its own Referer and never sends CORS headers,
///   so the stream is resolved server-side (redirects followed with Referer) and returned
///   with Referer/Origin headers — forcing it through the host's proxied stream path.
/// </summary>
public sealed class AniDubProvider(HttpClient http, IMemoryCache? cache = null)
    : ProviderBase(http, cache), IOnlineProvider
{
    private const string Host = "https://online.anidub.com";
    private const string DefaultPlayer = "https://player.ladonyvesna2005.info";
    private const string SibnetHost = "https://video.sibnet.ru";
    private const string SibnetPrefix = "sib_";
    private const string UserAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    private const int MaxResolveAttempts = 8;

    // CDN node health, process-wide like lampac's AnidubStore (dead/alive with TTL).
    private static readonly object NodeLock = new();
    private static readonly Dictionary<string, DateTime> DeadNodes = new(StringComparer.OrdinalIgnoreCase);
    private static readonly HashSet<string> BadNodes = new(StringComparer.OrdinalIgnoreCase) { "cdn1.anivids.link" };

    public string Id => "anidub";
    public string Name => "AniDUB";
    public ProviderDescriptor Descriptor => new(Id, Name, "anime", Slow: true);

    public Task<IReadOnlyList<SourceItem>> SearchAsync(MediaQuery query, CancellationToken cancellationToken)
    {
        var title = query.Title ?? query.OriginalTitle;
        if (string.IsNullOrWhiteSpace(title))
            return Task.FromResult<IReadOnlyList<SourceItem>>([]);

        return CachedAsync<IReadOnlyList<SourceItem>>(
            $"anidub:search:{title}",
            TimeSpan.FromHours(4),
            async () =>
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, $"{Host}/index.php?do=search")
                {
                    Content = new FormUrlEncodedContent(new Dictionary<string, string>
                    {
                        ["do"] = "search",
                        ["subaction"] = "search",
                        ["search_start"] = "0",
                        ["full_search"] = "0",
                        ["result_from"] = "1",
                        ["story"] = title,
                    }),
                };
                var html = await GetStringAsync(request, cancellationToken);
                var mediaType = string.Equals(query.Type, "movie", StringComparison.OrdinalIgnoreCase) ? "movie" : "tv";
                var items = new List<SourceItem>();
                foreach (Match card in Card.Matches(html))
                {
                    var name = Text(ThTitle.Match(html[card.Index..]).Groups[1].Value);
                    if (string.IsNullOrWhiteSpace(name))
                        continue;
                    var url = card.Groups[1].Value;
                    var season = SeasonFromTitle(name);
                    items.Add(new SourceItem(
                        Id,
                        Name,
                        $"{season}|{url}",
                        name,
                        null,
                        null,
                        null,
                        string.Empty,
                        null,
                        mediaType));
                    if (items.Count >= 6)
                        break;
                }
                return (IReadOnlyList<SourceItem>)items;
            });
    }

    public async Task<EpisodesResult> GetEpisodesAsync(SourceSelection selection, CancellationToken cancellationToken)
    {
        // Season number and the page URL ride in the SourceId, separated by '|'.
        var parts = selection.SourceId.Split('|', 2);
        var season = parts.Length == 2 && int.TryParse(parts[0], out var parsed) && parsed > 0 ? parsed : 1;
        var pageUrl = parts[^1];

        var page = await GetStringAsync(Get(pageUrl, Host + "/"), cancellationToken);
        var episodes = ParsePlayerEpisodes(page, out var player) ?? ParseSibnetEpisodes(page);
        if (episodes.Count == 0)
            return new EpisodesResult([], 0);

        var items = episodes
            .Select((episode, index) => new EpisodeItem(
                $"{Id}:{selection.SourceId}:{episode.Ref}",
                season,
                episode.Number ?? index + 1,
                $"{episode.Number ?? index + 1} серия",
                "AniDUB",
                null,
                [new AudioItem($"{Id}:{index}", "AniDUB", LocatorCodec.Encode(new AniDubLocator(episode.Ref, player)))],
                LocatorCodec.Encode(new AniDubLocator(episode.Ref, player))))
            .ToArray();
        return new EpisodesResult(items, season);
    }

    public async Task<ResolvedPlayback> ResolveAsync(PlaybackSelection selection, CancellationToken cancellationToken)
    {
        var locator = string.IsNullOrWhiteSpace(selection.Locator)
            ? throw new ProviderException("AniDUB playback locator is missing.")
            : LocatorCodec.Decode<AniDubLocator>(selection.Locator);
        return locator.Ref.StartsWith(SibnetPrefix, StringComparison.Ordinal)
            ? await ResolveSibnetAsync(locator.Ref[SibnetPrefix.Length..], cancellationToken)
            : await ResolvePlayerAsync(locator.Ref, locator.Player ?? DefaultPlayer, cancellationToken);
    }

    // Общий плеер: master подписан User-Agent клиента; узлы cdnN.anivids.link ротируются
    // и часть мёртвая — переспрашиваем master, пока не выпадет живой узел.
    private async Task<ResolvedPlayback> ResolvePlayerAsync(string hash, string player, CancellationToken cancellationToken)
    {
        if (!HashRegex.IsMatch(hash))
            throw new ProviderException("AniDUB episode reference is invalid.");

        var playerHeaders = PlayerHeaders(player);
        for (var attempt = 0; attempt < MaxResolveAttempts; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var body = await GetStringAsync(
                WithHeaders(Get($"{player}/vid.php?v=/{hash}", player + "/"), UserAgent), cancellationToken);
            var variants = ParseVariants(body);
            if (variants.Count == 0)
                continue;

            var node = HostOf(variants[0].Url);
            if (BadNodes.Contains(node) || IsDead(node))
                continue;

            var probe = await GetStringAsync(
                WithHeaders(Get(variants[0].Url, player + "/"), UserAgent), cancellationToken);
            if (probe.Contains("#EXTM3U", StringComparison.Ordinal))
            {
                MarkAlive(node);
                var best = variants[0];
                return new ResolvedPlayback(best.Url, best.Label, "AniDUB", playerHeaders);
            }
            MarkDead(node);
        }
        throw new ProviderException("AniDUB did not return a live stream.");
    }

    // Sibnet: файл добывается из shell.php вставки, оба редиректа до CDN разрешаются здесь
    // (только со своим Referer пускают) и клиенту отдаётся готовый адрес плюс Referer/Origin
    // — поток обязан идти через серверный прокси, т.к. CDN sibnet не отдаёт CORS.
    private async Task<ResolvedPlayback> ResolveSibnetAsync(string videoid, CancellationToken cancellationToken)
    {
        if (!SibnetIdRegex.IsMatch(videoid))
            throw new ProviderException("AniDUB sibnet id is invalid.");

        var shell = await GetStringAsync(
            WithHeaders(Get($"{SibnetHost}/shell.php?videoid={videoid}", Host + "/"), UserAgent),
            cancellationToken);
        var file = SibnetFile.Match(shell);
        if (!file.Success)
            throw new ProviderException("AniDUB did not return a sibnet stream.");

        var url = file.Groups[1].Value;
        if (url.StartsWith("//", StringComparison.Ordinal)) url = "https:" + url;
        else if (url.StartsWith("/", StringComparison.Ordinal)) url = SibnetHost + url;
        else if (!url.StartsWith("http", StringComparison.Ordinal)) throw new ProviderException("AniDUB sibnet stream is invalid.");

        var direct = await ResolveSibnetDirectAsync(url, cancellationToken);
        if (!string.IsNullOrEmpty(direct))
            url = direct!;

        var quality = SibnetQuality.Match(shell);
        var label = quality.Success && int.TryParse(quality.Groups[1].Value, out var height)
            ? $"{height}p"
            : "720p";

        return new ResolvedPlayback(url, label, "AniDUB", new Dictionary<string, string>
        {
            ["Referer"] = SibnetHost + "/",
            ["Origin"] = SibnetHost,
        });
    }

    private async Task<string?> ResolveSibnetDirectAsync(string url, CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Referrer = new Uri(SibnetHost + "/");
            request.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(0, 1);
            using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (response.IsSuccessStatusCode)
                return response.RequestMessage?.RequestUri?.ToString();
        }
        catch (HttpRequestException)
        {
            // Не разрешилось — отдадим исходный адрес с Referer.
        }
        return null;
    }

    private IReadOnlyList<(string Ref, double? Number)>? ParsePlayerEpisodes(string page, out string? player)
    {
        player = null;
        foreach (Match iframe in Iframe.Matches(page))
        {
            var src = iframe.Groups[1].Value.Trim().Replace("&amp;", "&");
            if (src.StartsWith("//", StringComparison.Ordinal)) src = "https:" + src;
            var match = PlayerSrc.Match(src);
            if (!match.Success || !HashRegex.IsMatch(match.Groups[2].Value.TrimStart('/')))
                continue;
            player = match.Groups[1].Value;
            return
            [
                (match.Groups[2].Value.TrimStart('/'), 1)
            ];
        }
        return null;
    }

    private static IReadOnlyList<(string Ref, double? Number)> ParseSibnetEpisodes(string page)
    {
        var episodes = new List<(string Ref, double? Number)>();
        foreach (Match span in SibnetSpan.Matches(page))
        {
            var number = double.TryParse(span.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture, out var parsed)
                ? parsed
                : (double?)null;
            episodes.Add((SibnetPrefix + span.Groups[1].Value, number));
        }
        return episodes;
    }

    private static IReadOnlyList<(string Url, string Label)> ParseVariants(string body)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var variants = new List<(string Url, string Label)>();
        foreach (Match match in Variant.Matches(body))
        {
            var url = match.Groups[1].Value.Trim();
            if (!url.StartsWith("http", StringComparison.Ordinal) || !seen.Add(url))
                continue;
            var label = url.Contains("/fhd.mp4/", StringComparison.Ordinal) ? "1080p"
                : url.Contains("/hd.mp4/", StringComparison.Ordinal) ? "720p"
                : url.Contains("/sd.mp4/", StringComparison.Ordinal) ? "480p"
                : "auto";
            variants.Add((url, label));
        }
        return variants
            .OrderByDescending(variant => QualityRank(variant.Label))
            .ToArray();
    }

    private static int QualityRank(string label) => label switch
    {
        "1080p" => 1080,
        "720p" => 720,
        "480p" => 480,
        _ => 0,
    };

    private static IReadOnlyDictionary<string, string> PlayerHeaders(string player) => new Dictionary<string, string>
    {
        ["User-Agent"] = UserAgent,
        ["Accept"] = "*/*",
        ["Referer"] = player + "/",
        ["Origin"] = player,
    };

    private static HttpRequestMessage WithHeaders(HttpRequestMessage request, string userAgent)
    {
        request.Headers.TryAddWithoutValidation("User-Agent", userAgent);
        return request;
    }

    private static bool IsDead(string node)
    {
        lock (NodeLock)
            return DeadNodes.TryGetValue(node, out var expires) && expires > DateTime.UtcNow;
    }

    private static void MarkDead(string node)
    {
        lock (NodeLock)
            DeadNodes[node] = DateTime.UtcNow.AddMinutes(20);
    }

    private static void MarkAlive(string node)
    {
        lock (NodeLock)
            DeadNodes.Remove(node);
    }

    private static string HostOf(string url)
    {
        var start = url.IndexOf("//", StringComparison.Ordinal) + 2;
        var end = url.IndexOf('/', start);
        return url.Substring(start, (end < 0 ? url.Length : end) - start);
    }

    private static string Text(string html) =>
        string.IsNullOrEmpty(html) ? string.Empty : Tag.Replace(html, string.Empty).Trim();

    private static int SeasonFromTitle(string title)
    {
        foreach (var pattern in SeasonTitle)
        {
            var match = pattern.Match(title);
            if (match.Success && int.TryParse(match.Groups[1].Value, out var season) && season > 0)
                return season;
        }
        return 1;
    }

    private static readonly Regex Card = new("href=\"(https?://[^\"]+?/\\d+-[^\"]+\\.html)\"", RegexOptions.Compiled);
    private static readonly Regex ThTitle = new("class=\"th-title\">([^<]+)<", RegexOptions.Compiled);
    private static readonly Regex Tag = new("<[^>]*>", RegexOptions.Compiled);
    private static readonly Regex[] SeasonTitle =
    [
        new Regex("(?i)(?:тв|tv)\\s*[-–—]?\\s*(\\d{1,2})\\b", RegexOptions.Compiled),
        new Regex("(?i)(\\d{1,2})\\s*(?:-?(?:й|ый|nd|rd|th))?\\s*(?:сезон|season)", RegexOptions.Compiled),
        new Regex("(?i)(?:сезон|season)\\s*(\\d{1,2})", RegexOptions.Compiled),
    ];
    private static readonly Regex Iframe = new("<iframe[^>]+src=\"([^\"]+)\"", RegexOptions.Compiled);
    private static readonly Regex PlayerSrc = new("^(https?://[\\w.-]+(?::\\d+)?)/index\\.php\\?v=/([^\"&]+)", RegexOptions.Compiled);
    private static readonly Regex HashRegex = new("^s\\d{1,4}/[A-Za-z0-9]{8,64}$", RegexOptions.Compiled);
    private static readonly Regex Variant = new("^(https?://[^\\r\\n]+)$", RegexOptions.Compiled | RegexOptions.Multiline);
    private static readonly Regex SibnetSpan = new(
        "<span[^>]+data=\"https?://video\\.sibnet\\.ru/shell\\.php\\?videoid=(\\d+)\"[^>]*>[^0-9]{0,20}(\\d+)", RegexOptions.Compiled);
    private static readonly Regex SibnetIdRegex = new("^\\d{4,12}$", RegexOptions.Compiled);
    private static readonly Regex SibnetFile = new("src:\\s*\"([^\"]+\\.mp4)\"", RegexOptions.Compiled);
    private static readonly Regex SibnetQuality = new("(?:HD)?(2160|1080|720|480)[pр]", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private sealed record AniDubLocator(string Ref, string? Player);
}
