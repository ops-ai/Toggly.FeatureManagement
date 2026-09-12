using Toggly.FeatureManagement.Client;
using Toggly.FeatureManagement.Client.Desktop;
using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
await using var client = DesktopClient.Create(new TogglyClientOptions
{
    // Frontend App Keys are distributed with the app; never use a backend key.
    AppKey = Environment.GetEnvironmentVariable("TOGGLY_APP_KEY"),
    Defaults = new Dictionary<string, bool> { ["new-dashboard"] = false },
    Context = new EvaluationContext("example-user")
}, http);
client.Error += (_, error) => Console.Error.WriteLine(error.Message);
await client.InitializeAsync();
Console.WriteLine($"Ready={client.IsReady}; new-dashboard={client.IsEnabled("new-dashboard")}");
