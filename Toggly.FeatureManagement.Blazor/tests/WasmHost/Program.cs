using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using Microsoft.JSInterop;
using Toggly.FeatureManagement.Blazor;
using Toggly.FeatureManagement.Client;
using WasmHost;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.Services.AddScoped(_ => new HttpClient(new OfflineDefinitions()));
builder.Services.AddTogglyBlazorWebAssembly(sp => new()
{
    AppKey = ((IJSInProcessRuntime)sp.GetRequiredService<IJSRuntime>()).Invoke<string>("fixtureKey"),
    EnableTelemetry = ((IJSInProcessRuntime)sp.GetRequiredService<IJSRuntime>()).Invoke<bool>("telemetryEnabled"),
    Environment = ((IJSInProcessRuntime)sp.GetRequiredService<IJSRuntime>()).Invoke<string>("fixtureEnvironment"),
    MetricsBaseUrl = ((IJSInProcessRuntime)sp.GetRequiredService<IJSRuntime>()).Invoke<string>("collectorUrl"),
    EnableLiveUpdates = false,
    Defaults = new Dictionary<string, bool> { ["on"] = true },
    Context = new("private-user", ["private-group"], new Dictionary<string, string> { ["secret"] = "private-claim" })
});
await builder.Build().RunAsync();

internal sealed class OfflineDefinitions : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable));
}
