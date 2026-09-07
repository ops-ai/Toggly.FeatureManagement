using FluentAssertions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Moq.Protected;
using System.Net;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text.Json;
using Toggly.FeatureManagement.Data;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

[Collection(TogglyFeatureProviderCollection.Name)]
public class DefinitionCacheHitTelemetryTests : IDisposable
{
    private readonly Mock<ILoggerFactory> _loggerFactoryMock;
    private readonly Mock<IHttpClientFactory> _httpClientFactoryMock;
    private readonly Mock<IHostEnvironment> _hostEnvironmentMock;
    private readonly Mock<IServiceProvider> _serviceProviderMock;
    private readonly Mock<IFeatureStateInternalService> _featureStateServiceMock;
    private readonly Mock<IFeatureUsageStatsProvider> _usageStatsMock;
    private TogglyFeatureProvider? _provider;

    public DefinitionCacheHitTelemetryTests()
    {
        TogglyFeatureProvider.WebSocketClientFactoryOverride = _ =>
            throw new InvalidOperationException("WebSocket disabled in unit tests");

        _loggerFactoryMock = new Mock<ILoggerFactory>();
        _loggerFactoryMock.Setup(x => x.CreateLogger(It.IsAny<string>()))
            .Returns(new Mock<ILogger>().Object);

        _httpClientFactoryMock = new Mock<IHttpClientFactory>();
        _hostEnvironmentMock = new Mock<IHostEnvironment>();
        _hostEnvironmentMock.Setup(x => x.EnvironmentName).Returns("Production");

        _featureStateServiceMock = new Mock<IFeatureStateInternalService>();
        _usageStatsMock = new Mock<IFeatureUsageStatsProvider>();

        _serviceProviderMock = new Mock<IServiceProvider>();
        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureSnapshotProvider)))
            .Returns((IFeatureSnapshotProvider?)null);
        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureStateInternalService)))
            .Returns(_featureStateServiceMock.Object);
        _serviceProviderMock.Setup(x => x.GetService(typeof(IMetricsService)))
            .Returns((IMetricsService?)null);
        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureUsageStatsProvider)))
            .Returns(_usageStatsMock.Object);
    }

    public void Dispose()
    {
        DrainInFlightRefresh(_provider);
        _provider?.Dispose();
        _provider = null;
        TogglyFeatureProvider.WebSocketClientFactoryOverride = null;
    }

    /// <summary>
    /// Wait for any in-flight <c>RefreshFeatures</c> to finish before disposing the
    /// provider (and its refresh semaphore), so later collection tests are not affected
    /// by orphaned HTTP callbacks.
    /// </summary>
    private static void DrainInFlightRefresh(TogglyFeatureProvider? provider)
    {
        if (provider == null)
            return;

        try
        {
            var field = typeof(TogglyFeatureProvider).GetField(
                "_refreshSemaphore",
                BindingFlags.Instance | BindingFlags.NonPublic);
            if (field?.GetValue(provider) is not SemaphoreSlim semaphore)
                return;

            if (semaphore.Wait(TimeSpan.FromSeconds(5)))
                semaphore.Release();
        }
        catch (ObjectDisposedException)
        {
            // Already disposed — nothing to drain.
        }
    }

    private static IOptions<TogglySettings> CreateSettings() =>
        Options.Create(new TogglySettings
        {
            AppKey = "test-app-key",
            Environment = "test-env",
            DefinitionsBaseUrl = "https://definitions.toggly.io/"
        });

    private void SetupHttpClient(Func<HttpRequestMessage, HttpResponseMessage> responder)
    {
        var handlerMock = new Mock<HttpMessageHandler>(MockBehavior.Loose);
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync((HttpRequestMessage request, CancellationToken _) => responder(request));

        _httpClientFactoryMock.Setup(x => x.CreateClient("toggly"))
            .Returns(() => new HttpClient(handlerMock.Object)
            {
                BaseAddress = new Uri("https://definitions.toggly.io/")
            });
    }

    private static string SerializeDefinitions(params string[] featureKeys)
    {
        var definitions = featureKeys.Select(key => new FeatureDefinitionModel
        {
            FeatureKey = key,
            Filters = new List<FeatureFilter>()
        }).ToList();
        return JsonSerializer.Serialize(definitions);
    }

    private static async Task WaitForConditionAsync(Func<bool> condition, TimeSpan timeout)
    {
        var start = DateTime.UtcNow;
        while (!condition() && DateTime.UtcNow - start < timeout)
            await Task.Delay(50);
        condition().Should().BeTrue($"condition was not met within {timeout}");
    }

    private static async Task WaitUntilLoadedAsync(TogglyFeatureProvider provider)
    {
        await WaitForConditionAsync(
            () => provider.GetDebugInfo().Loaded,
            TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task RefreshFeatures_WhenNotModified_RecordsDefinitionCacheHit()
    {
        var callCount = 0;
        var json = SerializeDefinitions("feature-a");
        SetupHttpClient(_ =>
        {
            callCount++;
            if (callCount == 1)
            {
                var response = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json)
                };
                response.Headers.ETag = new EntityTagHeaderValue("\"etag1\"");
                return response;
            }

            return new HttpResponseMessage(HttpStatusCode.NotModified);
        });

        _provider = new TogglyFeatureProvider(
            CreateSettings(),
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        await WaitUntilLoadedAsync(_provider);
        await WaitForConditionAsync(
            () => _usageStatsMock.Invocations.Any(i => i.Method.Name == nameof(IFeatureUsageStatsProvider.RecordDefinitionCacheMiss)),
            TimeSpan.FromSeconds(5));

        // Force a second refresh that receives 304
        var refresh = typeof(TogglyFeatureProvider)
            .GetMethod("RefreshFeatures", BindingFlags.NonPublic | BindingFlags.Instance);
        var task = (Task)refresh!.Invoke(_provider, new object?[] { null })!;
        await task;

        _usageStatsMock.Verify(x => x.RecordDefinitionCacheHit(), Times.AtLeastOnce);
        _usageStatsMock.Verify(x => x.RecordDefinitionCacheMiss(), Times.Once);
    }

    [Fact]
    public async Task RefreshFeatures_WhenNewRevision_RecordsDefinitionCacheMiss()
    {
        var json = SerializeDefinitions("new-feature");
        SetupHttpClient(_ =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json)
            };
            response.Headers.ETag = new EntityTagHeaderValue("\"etag-new\"");
            return response;
        });

        _provider = new TogglyFeatureProvider(
            CreateSettings(),
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        await WaitUntilLoadedAsync(_provider);
        await WaitForConditionAsync(
            () => _usageStatsMock.Invocations.Any(i => i.Method.Name == nameof(IFeatureUsageStatsProvider.RecordDefinitionCacheMiss)),
            TimeSpan.FromSeconds(5));

        _usageStatsMock.Verify(x => x.RecordDefinitionCacheMiss(), Times.AtLeastOnce);
    }

    [Fact]
    public async Task TimerCallback_WhenPollSkipped_RecordsDefinitionCacheHit()
    {
        // Seed a first successful apply so _loaded is true; subsequent timer skip is a hit.
        var callCount = 0;
        var json = SerializeDefinitions("seed");
        SetupHttpClient(_ =>
        {
            callCount++;
            if (callCount == 1)
            {
                var response = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json)
                };
                response.Headers.ETag = new EntityTagHeaderValue("\"seed\"");
                return response;
            }

            return new HttpResponseMessage(HttpStatusCode.NotModified);
        });

        _provider = new TogglyFeatureProvider(
            CreateSettings(),
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        await WaitUntilLoadedAsync(_provider);
        DrainInFlightRefresh(_provider);

        _usageStatsMock.Invocations.Clear();
        _provider.SetWebSocketConnectedForTests(true);
        _provider.SetLastFallbackRefreshForTests(DateTime.UtcNow - TimeSpan.FromMinutes(1));
        _provider.InvokeTimerCallbackForTests();
        await Task.Delay(200);

        _usageStatsMock.Verify(x => x.RecordDefinitionCacheHit(), Times.Once);
        _usageStatsMock.Verify(x => x.RecordDefinitionCacheMiss(), Times.Never);
    }

    [Fact]
    public async Task LoadSnapshot_RecordsDefinitionCacheHit_BeforeNetwork()
    {
        var snapshotProviderMock = new Mock<IFeatureSnapshotProvider>();
        snapshotProviderMock
            .Setup(x => x.GetFeaturesSnapshotAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new FeatureDefinitionsSnapshot
            {
                Features = new List<FeatureDefinitionModel>
                {
                    new FeatureDefinitionModel
                    {
                        FeatureKey = "snapshot-feature",
                        Filters = new List<FeatureFilter>()
                    }
                },
                ETag = "\"etag-snapshot\""
            });

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureSnapshotProvider)))
            .Returns(snapshotProviderMock.Object);

        SetupHttpClient(_ => new HttpResponseMessage(HttpStatusCode.NotModified));

        _provider = new TogglyFeatureProvider(
            CreateSettings(),
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        await WaitUntilLoadedAsync(_provider);
        await WaitForConditionAsync(
            () => _usageStatsMock.Invocations.Count(i => i.Method.Name == nameof(IFeatureUsageStatsProvider.RecordDefinitionCacheHit)) >= 2,
            TimeSpan.FromSeconds(5));

        // Snapshot apply + 304
        _usageStatsMock.Verify(x => x.RecordDefinitionCacheHit(), Times.AtLeast(2));
    }

    [Fact]
    public async Task RefreshFeatures_WhenSameETagOn200_RecordsHitNotMiss()
    {
        var callCount = 0;
        var json = SerializeDefinitions("same-etag");
        SetupHttpClient(_ =>
        {
            callCount++;
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json)
            };
            response.Headers.ETag = new EntityTagHeaderValue("\"same\"");
            return response;
        });

        _provider = new TogglyFeatureProvider(
            CreateSettings(),
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        await WaitUntilLoadedAsync(_provider);
        await WaitForConditionAsync(
            () => _usageStatsMock.Invocations.Any(i => i.Method.Name == nameof(IFeatureUsageStatsProvider.RecordDefinitionCacheMiss)),
            TimeSpan.FromSeconds(5));

        // Drain the constructor-triggered refresh before clearing invocations / forcing another.
        DrainInFlightRefresh(_provider);
        _usageStatsMock.Invocations.Clear();

        var refresh = typeof(TogglyFeatureProvider)
            .GetMethod("RefreshFeatures", BindingFlags.NonPublic | BindingFlags.Instance);
        var task = (Task)refresh!.Invoke(_provider, new object?[] { null })!;
        await task;

        _usageStatsMock.Verify(x => x.RecordDefinitionCacheHit(), Times.Once);
        _usageStatsMock.Verify(x => x.RecordDefinitionCacheMiss(), Times.Never);
        callCount.Should().BeGreaterThanOrEqualTo(2);
    }
}
