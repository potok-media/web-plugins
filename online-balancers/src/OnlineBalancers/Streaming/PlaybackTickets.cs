namespace OnlineBalancers;

public sealed record StreamTicket(string Url, IReadOnlyDictionary<string, string>? Headers);

public sealed record PlaybackTicket(string Provider, PlaybackSelection Selection);
