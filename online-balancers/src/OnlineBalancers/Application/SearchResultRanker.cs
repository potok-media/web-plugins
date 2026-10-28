using System.Text;

namespace OnlineBalancers;

internal static class SearchResultRanker
{
    private const int LocalizedTitleBonus = 20;
    private const int DisplayTitleBonus = 2;

    public static IReadOnlyList<SourceItem> FilterAndRank(
        MediaQuery query,
        IEnumerable<SourceItem> items)
    {
        var queryAliases = Aliases(query.Title, query.OriginalTitle, LocalizedTitleBonus);
        var materialized = items.ToArray();
        if (queryAliases.Count == 0)
            return materialized;

        return materialized
            .Select((item, index) => new RankedItem(item, Score(query, queryAliases, item), index))
            .Where(candidate => candidate.Score > 0)
            .OrderByDescending(candidate => candidate.Score)
            .ThenBy(candidate => candidate.Index)
            .Select(candidate => candidate.Item)
            .ToArray();
    }

    private static int Score(
        MediaQuery query,
        IReadOnlyList<TitleAlias> queryAliases,
        SourceItem item)
    {
        if (!CompatibleMediaType(query.Type, item.MediaType) || !CompatibleYear(query.Year, item.Year))
            return 0;

        var itemAliases = Aliases(item.Title, item.OriginalTitle, DisplayTitleBonus);
        var best = 0;
        foreach (var queryAlias in queryAliases)
        foreach (var itemAlias in itemAliases)
            best = Math.Max(best, MatchScore(queryAlias, itemAlias));
        return best;
    }

    private static int MatchScore(TitleAlias query, TitleAlias item)
    {
        if (query.Value == item.Value)
            return 100 + query.Bonus + item.Bonus;

        if (query.Value.Length >= 5 && item.Value.Length >= 5
            && Similarity(query.Value, item.Value) >= 0.88)
        {
            return 70 + query.Bonus + item.Bonus;
        }

        var intersection = query.Tokens.Intersect(item.Tokens).Count();
        if (intersection == 0)
            return 0;

        if (intersection == query.Tokens.Count)
            return 90 + query.Bonus + item.Bonus;

        var queryCoverage = (double)intersection / query.Tokens.Count;
        var itemCoverage = (double)intersection / item.Tokens.Count;
        if (intersection >= Math.Min(2, query.Tokens.Count)
            && queryCoverage >= 0.75
            && itemCoverage >= 0.60)
        {
            return 75 + query.Bonus + item.Bonus;
        }

        return 0;
    }

    private static IReadOnlyList<TitleAlias> Aliases(
        string? title,
        string? originalTitle,
        int titleBonus)
    {
        var aliases = new List<TitleAlias>();
        AddAliases(aliases, title, titleBonus);
        AddAliases(aliases, originalTitle, 0);
        return aliases
            .DistinctBy(alias => alias.Value)
            .ToArray();
    }

    private static void AddAliases(List<TitleAlias> aliases, string? value, int bonus)
    {
        if (string.IsNullOrWhiteSpace(value))
            return;

        foreach (var candidate in value.Split(['/', '|'], StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            var normalized = Normalize(candidate);
            if (normalized.Length == 0)
                continue;
            aliases.Add(new TitleAlias(
                normalized,
                normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal),
                bonus));
        }
    }

    private static string Normalize(string value)
    {
        var normalized = value.Normalize(NormalizationForm.FormKC).ToLowerInvariant().Replace('ё', 'е');
        var result = new StringBuilder(normalized.Length);
        var pendingSpace = false;
        foreach (var character in normalized)
        {
            if (char.IsLetterOrDigit(character))
            {
                if (pendingSpace && result.Length > 0)
                    result.Append(' ');
                result.Append(character);
                pendingSpace = false;
            }
            else
            {
                pendingSpace = true;
            }
        }
        return result.ToString();
    }

    private static bool CompatibleMediaType(string? expected, string? actual)
    {
        var expectedType = CanonicalMediaType(expected);
        var actualType = CanonicalMediaType(actual);
        return expectedType is null || actualType is null || expectedType == actualType;
    }

    private static string? CanonicalMediaType(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        "movie" or "film" => "movie",
        "tv" or "series" or "serial" => "tv",
        _ => null,
    };

    private static bool CompatibleYear(int? expected, int? actual) =>
        expected is null || actual is null || Math.Abs(expected.Value - actual.Value) <= 1;

    private static double Similarity(string left, string right)
    {
        var longest = Math.Max(left.Length, right.Length);
        return longest == 0 ? 1 : 1 - (double)EditDistance(left, right) / longest;
    }

    private static int EditDistance(string left, string right)
    {
        var previous = Enumerable.Range(0, right.Length + 1).ToArray();
        var current = new int[right.Length + 1];
        for (var leftIndex = 1; leftIndex <= left.Length; leftIndex++)
        {
            current[0] = leftIndex;
            for (var rightIndex = 1; rightIndex <= right.Length; rightIndex++)
            {
                var substitution = left[leftIndex - 1] == right[rightIndex - 1] ? 0 : 1;
                current[rightIndex] = Math.Min(
                    Math.Min(current[rightIndex - 1] + 1, previous[rightIndex] + 1),
                    previous[rightIndex - 1] + substitution);
            }
            (previous, current) = (current, previous);
        }
        return previous[right.Length];
    }

    private sealed record TitleAlias(string Value, HashSet<string> Tokens, int Bonus);
    private sealed record RankedItem(SourceItem Item, int Score, int Index);
}
