using OnlineBalancers;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOnlineBalancers();

var app = builder.Build();
app.UseCors();
app.MapPluginAssets();
app.MapOnlineBalancerApi();
app.Run();

public partial class Program;
