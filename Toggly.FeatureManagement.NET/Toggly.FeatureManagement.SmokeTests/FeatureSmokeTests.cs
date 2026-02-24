using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace Toggly.FeatureManagement.SmokeTests;

public class FeatureSmokeTests
{
    private const string SmokeEnvironment = "Production";
    private const string DefinitionsBaseUrl = "https://definitions.toggly.io/";

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FlagOn_True_And_FlagOff_False(bool useSignedDefinitions)
    {
        var appKey = Environment.GetEnvironmentVariable("TOGGLY_SMOKE_APP_KEY_BACKEND");
        if (string.IsNullOrWhiteSpace(appKey))
        {
            return;
        }

        var settings = Options.Create(new TogglySettings
        {
            AppKey = appKey,
            Environment = SmokeEnvironment,
            UseSignedDefinitions = useSignedDefinitions,
            DefinitionsBaseUrl = DefinitionsBaseUrl
        });

        var services = new ServiceCollection();
        services.AddHttpClient("toggly", httpClient =>
        {
            httpClient.BaseAddress = new Uri(DefinitionsBaseUrl);
        });
        services.AddSingleton<IFeatureStateInternalService, TogglyFeatureStateService>();
        var serviceProvider = services.BuildServiceProvider();
        var httpClientFactory = serviceProvider.GetRequiredService<IHttpClientFactory>();
        var environment = new SmokeHostEnvironment();

        using var provider = new TogglyFeatureProvider(
            settings,
            environment,
            NullLoggerFactory.Instance,
            httpClientFactory,
            serviceProvider);

        await AssertFlagsEventuallyAsync(provider);
    }

    [Fact]
    public async Task WebSocket_Connects_And_Receives_Definitions()
    {
        var appKey = Environment.GetEnvironmentVariable("TOGGLY_SMOKE_APP_KEY_BACKEND");
        if (string.IsNullOrWhiteSpace(appKey))
        {
            return;
        }

        using var ws = new ClientWebSocket();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));

        await ws.ConnectAsync(
            new Uri($"wss://definitions.toggly.io/{appKey}/ws"),
            cts.Token);

        Assert.Equal(WebSocketState.Open, ws.State);

        var buffer = new byte[65536];
        var result = await ws.ReceiveAsync(buffer, cts.Token);

        Assert.Equal(WebSocketMessageType.Text, result.MessageType);

        var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
        using var doc = JsonDocument.Parse(json);
        Assert.True(doc.RootElement.TryGetProperty("type", out var typeProp));
        Assert.Equal("definitions", typeProp.GetString());
        Assert.True(doc.RootElement.TryGetProperty("data", out _));
        Assert.True(doc.RootElement.TryGetProperty("timestamp", out _));

        await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
    }

    private static async Task AssertFlagsEventuallyAsync(TogglyFeatureProvider provider)
    {
        var timeoutAt = DateTime.UtcNow.AddSeconds(30);

        while (DateTime.UtcNow < timeoutAt)
        {
            var flagOn = await provider.GetFeatureDefinitionAsync("FlagOn");
            var flagOff = await provider.GetFeatureDefinitionAsync("FlagOff");

            var isOn = flagOn?.EnabledFor?.Any(f => f.Name == "AlwaysOn") == true;
            var isOff = flagOff?.EnabledFor?.Any(f => f.Name == "AlwaysOn") == true;

            if (isOn && !isOff)
            {
                return;
            }

            await Task.Delay(500);
        }

        var currentFlagOn = await provider.GetFeatureDefinitionAsync("FlagOn");
        var currentFlagOff = await provider.GetFeatureDefinitionAsync("FlagOff");
        var currentIsOn = currentFlagOn?.EnabledFor?.Any(f => f.Name == "AlwaysOn") == true;
        var currentIsOff = currentFlagOff?.EnabledFor?.Any(f => f.Name == "AlwaysOn") == true;

        Assert.True(currentIsOn, "Expected FlagOn to be AlwaysOn/true.");
        Assert.False(currentIsOff, "Expected FlagOff to be false.");
    }

    private sealed class SmokeHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Production;
        public string ApplicationName { get; set; } = "Toggly.FeatureManagement.SmokeTests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }
}
