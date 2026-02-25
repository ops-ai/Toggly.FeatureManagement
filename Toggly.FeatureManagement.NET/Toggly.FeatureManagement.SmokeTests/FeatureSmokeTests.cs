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
        Assert.SkipWhen(string.IsNullOrWhiteSpace(appKey), "TOGGLY_SMOKE_APP_KEY_BACKEND not configured");

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
    public async Task WebSocket_Connects_Via_Library()
    {
        var appKey = Environment.GetEnvironmentVariable("TOGGLY_SMOKE_APP_KEY_BACKEND");
        Assert.SkipWhen(string.IsNullOrWhiteSpace(appKey), "TOGGLY_SMOKE_APP_KEY_BACKEND not configured");

        var settings = Options.Create(new TogglySettings
        {
            AppKey = appKey,
            Environment = SmokeEnvironment,
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

        var debugProvider = (IFeatureProviderDebug)provider;
        var timeoutAt = DateTime.UtcNow.AddSeconds(30);

        while (DateTime.UtcNow < timeoutAt)
        {
            var info = debugProvider.GetDebugInfo();
            if (info.Loaded && info.WebsocketClientRunning)
            {
                Assert.NotNull(info.Definitions);
                Assert.NotEmpty(info.Definitions);
                return;
            }

            await Task.Delay(500, TestContext.Current.CancellationToken);
        }

        var finalInfo = debugProvider.GetDebugInfo();
        Assert.True(finalInfo.Loaded, $"Provider failed to load definitions within timeout. LastError: {finalInfo.LastError}");
        Assert.True(finalInfo.WebsocketClientRunning, $"WebSocket did not connect within timeout. LastError: {finalInfo.LastError}");
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
