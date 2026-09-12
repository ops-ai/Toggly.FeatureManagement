using Toggly.FeatureManagement.Configuration;
using Toggly.FeatureManagement.Blazor.Server;
using BlazorHost;
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddRazorComponents().AddInteractiveServerComponents();
// The backend key belongs to this server process, never a browser configuration.
builder.Services.AddToggly(options => {
    options.AppKey = builder.Configuration["TOGGLY_APP_KEY"] ?? "";
    options.Environment = "Production";
    options.UseSignedDefinitions = true;
});
builder.Services.AddTogglyBlazorServer();
var app = builder.Build();
app.UseAntiforgery();
app.MapRazorComponents<App>().AddInteractiveServerRenderMode();
app.Run();
