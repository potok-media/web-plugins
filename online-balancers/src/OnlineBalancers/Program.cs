using OnlineBalancers;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOnlineBalancers(builder.Configuration);

var app = builder.Build();
app.UseCors();
app.MapPluginAssets();
app.MapOnlineBalancerApi();
app.MapStreamRelay();
app.Run();

public partial class Program;
