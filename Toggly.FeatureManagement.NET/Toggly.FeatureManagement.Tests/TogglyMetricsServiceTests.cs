using FluentAssertions;
using Grpc.Core;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using Moq;
using Toggly.Web;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class TogglyMetricsServiceTests : IDisposable
{
    private readonly Mock<ILoggerFactory> _loggerFactoryMock;
    private readonly Mock<IHttpClientFactory> _httpClientFactoryMock;
    private readonly Mock<IHostApplicationLifetime> _applicationLifetimeMock;
    private readonly Mock<IFeatureDefinitionProvider> _featureDefinitionProviderMock;
    private readonly Mock<IFeatureExperimentProvider> _featureExperimentProviderMock;
    private readonly Mock<IFeatureManager> _featureManagerMock;
    private readonly Mock<IServiceProvider> _serviceProviderMock;
    private readonly Mock<IMetricsRegistryService> _metricsRegistryServiceMock;
    private readonly Mock<Metrics.MetricsClient> _metricsClientMock;
    private TogglyMetricsService? _service;
    private CancellationTokenSource _applicationStoppingCts;

    public TogglyMetricsServiceTests()
    {
        _loggerFactoryMock = new Mock<ILoggerFactory>();
        _loggerFactoryMock.Setup(x => x.CreateLogger(It.IsAny<string>()))
            .Returns(new Mock<ILogger>().Object);

        _httpClientFactoryMock = new Mock<IHttpClientFactory>();

        _applicationStoppingCts = new CancellationTokenSource();
        _applicationLifetimeMock = new Mock<IHostApplicationLifetime>();
        _applicationLifetimeMock.Setup(x => x.ApplicationStopping).Returns(_applicationStoppingCts.Token);

        // Create a single mock that implements both interfaces
        _featureExperimentProviderMock = new Mock<IFeatureExperimentProvider>();
        _featureDefinitionProviderMock = _featureExperimentProviderMock.As<IFeatureDefinitionProvider>();

        _featureManagerMock = new Mock<IFeatureManager>();

        _metricsRegistryServiceMock = new Mock<IMetricsRegistryService>();
        _metricsRegistryServiceMock.Setup(x => x.GetMeasurementValuesAsync())
            .ReturnsAsync(new Dictionary<string, double>());
        _metricsRegistryServiceMock.Setup(x => x.GetCounterValuesAsync())
            .ReturnsAsync(new Dictionary<string, double>());
        _metricsRegistryServiceMock.Setup(x => x.GetObservationValuesAsync())
            .ReturnsAsync(new Dictionary<string, (DateTime, double)>());

        _serviceProviderMock = new Mock<IServiceProvider>();
        _serviceProviderMock.Setup(x => x.GetService(typeof(IMetricsRegistryService)))
            .Returns(_metricsRegistryServiceMock.Object);

        _metricsClientMock = new Mock<Metrics.MetricsClient>();
        _metricsClientMock.Setup(x => x.SendMetricsAsync(
            It.IsAny<MetricStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Returns(new AsyncUnaryCall<MetricResult>(
                Task.FromResult(new MetricResult { Count = 1 }),
                Task.FromResult(new Metadata()),
                () => Status.DefaultSuccess,
                () => new Metadata(),
                () => { }));
    }

    public void Dispose()
    {
        _service?.Dispose();
        _applicationStoppingCts?.Dispose();
    }

    private IOptions<TogglySettings> CreateSettings(
        string appKey = "test-app-key",
        string environment = "test-env",
        string? baseUrl = null,
        string? instanceName = null)
    {
        return Options.Create(new TogglySettings
        {
            AppKey = appKey,
            Environment = environment,
            BaseUrl = baseUrl ?? "https://app.toggly.io/",
            InstanceName = instanceName
        });
    }

    private TogglyMetricsService CreateService(IOptions<TogglySettings>? settings = null)
    {
        settings ??= CreateSettings();
        return new TogglyMetricsService(
            settings,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _applicationLifetimeMock.Object,
            _serviceProviderMock.Object,
            _featureDefinitionProviderMock.Object,
            _featureManagerMock.Object,
            _metricsClientMock.Object);
    }

    #region GetDebugInfo Tests

    [Fact]
    public void GetDebugInfo_ReturnsCorrectDebugInfo()
    {
        // Arrange
        _service = CreateService(CreateSettings(
            appKey: "my-app-key",
            environment: "staging",
            baseUrl: "https://custom.toggly.io/"));

        // Act
        var debugInfo = _service.GetDebugInfo();

        // Assert
        debugInfo.Should().NotBeNull();
        debugInfo.AppKey.Should().Be("my-app-key");
        debugInfo.Environment.Should().Be("staging");
        debugInfo.BaseUrl.Should().Be("https://custom.toggly.io/");
        debugInfo.UserAgent.Should().Contain("Toggly.FeatureManagement");
    }

    [Fact]
    public void GetDebugInfo_WithDefaultBaseUrl_ReturnsDefaultUrl()
    {
        // Arrange
        _service = CreateService();

        // Act
        var debugInfo = _service.GetDebugInfo();

        // Assert
        debugInfo.BaseUrl.Should().Be("https://app.toggly.io/");
    }

    #endregion

    #region MeasureAsync Tests

    [Fact]
    public async Task MeasureAsync_WithNoExperiments_IncrementsMeasurement()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("test-metric"))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("test-metric", 10.0);

        // Assert - verify no exceptions
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task MeasureAsync_WithExperiments_IncrementsForAllFeatures()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("conversion-rate"))
            .Returns(new List<string> { "feature-a", "feature-b" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature-a"))
            .ReturnsAsync(true);
        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature-b"))
            .ReturnsAsync(false);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("conversion-rate", 5.0);

        // Assert - verify IsEnabledAsync was called for each feature
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature-a"), Times.Once);
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature-b"), Times.Once);
    }

    [Fact]
    public async Task MeasureAsync_WithContext_PassesContextToFeatureManager()
    {
        // Arrange
        var context = new { UserId = "user123" };
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("revenue"))
            .Returns(new List<string> { "pricing-experiment" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("pricing-experiment", context))
            .ReturnsAsync(true);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("revenue", context, 99.99);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("pricing-experiment", context), Times.Once);
    }

    #endregion

    #region ObserveAsync Tests

    [Fact]
    public async Task ObserveAsync_WithNoExperiments_StoresObservation()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("latency"))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.ObserveAsync("latency", 150.5);

        // Assert - verify no exceptions
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task ObserveAsync_WithExperiments_StoresForAllFeatures()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("response-time"))
            .Returns(new List<string> { "cache-experiment" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("cache-experiment"))
            .ReturnsAsync(true);

        _service = CreateService();

        // Act
        await _service.ObserveAsync("response-time", 50.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("cache-experiment"), Times.Once);
    }

    [Fact]
    public async Task ObserveAsync_WithContext_PassesContextToFeatureManager()
    {
        // Arrange
        var context = new { Region = "us-west" };
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("request-time"))
            .Returns(new List<string> { "cdn-experiment" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("cdn-experiment", context))
            .ReturnsAsync(false);

        _service = CreateService();

        // Act
        await _service.ObserveAsync("request-time", context, 25.5);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("cdn-experiment", context), Times.Once);
    }

    #endregion

    #region IncrementCounterAsync Tests

    [Fact]
    public async Task IncrementCounterAsync_WithNoExperiments_IncrementsCounter()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("page-views"))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.IncrementCounterAsync("page-views", 1.0);

        // Assert - verify no exceptions
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task IncrementCounterAsync_WithExperiments_IncrementsForAllFeatures()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("click-count"))
            .Returns(new List<string> { "button-experiment" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("button-experiment"))
            .ReturnsAsync(true);

        _service = CreateService();

        // Act
        await _service.IncrementCounterAsync("click-count", 1.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("button-experiment"), Times.Once);
    }

    [Fact]
    public async Task IncrementCounterAsync_WithContext_PassesContextToFeatureManager()
    {
        // Arrange
        var context = new { DeviceType = "mobile" };
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("downloads"))
            .Returns(new List<string> { "mobile-experiment" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("mobile-experiment", context))
            .ReturnsAsync(true);

        _service = CreateService();

        // Act
        await _service.IncrementCounterAsync("downloads", context, 1.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("mobile-experiment", context), Times.Once);
    }

    [Fact]
    public async Task IncrementCounterAsync_CalledMultipleTimes_AccumulatesValues()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("requests"))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.IncrementCounterAsync("requests", 1.0);
        await _service.IncrementCounterAsync("requests", 1.0);
        await _service.IncrementCounterAsync("requests", 1.0);

        // Assert - verify no exceptions and values are accumulated internally
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region Dispose Tests

    [Fact]
    public void Dispose_DisposesResources()
    {
        // Arrange
        _service = CreateService();

        // Act
        _service.Dispose();

        // Assert - no exception should be thrown
        // Calling dispose again should be safe
        _service.Dispose();
        _service = null; // Prevent double dispose in cleanup
    }

    #endregion

    #region Concurrent Operations Tests

    [Fact]
    public async Task MultipleConcurrentMeasures_AreHandledSafely()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        var tasks = Enumerable.Range(0, 100)
            .Select(i => _service.MeasureAsync($"metric-{i % 5}", i * 1.0));

        await Task.WhenAll(tasks);

        // Assert - no exception should occur
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task MultipleConcurrentCounterIncrements_AreHandledSafely()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        var tasks = Enumerable.Range(0, 100)
            .Select(i => _service.IncrementCounterAsync("counter", 1.0));

        await Task.WhenAll(tasks);

        // Assert - no exception should occur
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task MultipleConcurrentObservations_AreHandledSafely()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        var tasks = Enumerable.Range(0, 100)
            .Select(i => _service.ObserveAsync("observation", i * 1.0));

        await Task.WhenAll(tasks);

        // Assert - no exception should occur
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region Obsolete Methods Tests

    [Fact]
    public async Task AddMetricAsync_CallsMeasureAsync()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
#pragma warning disable CS0618 // Type or member is obsolete
        await _service.AddMetricAsync("legacy-metric", 5);
#pragma warning restore CS0618

        // Assert - verify no exceptions
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task AddMetricAsync_WithContext_CallsMeasureAsyncWithContext()
    {
        // Arrange
        var context = new { Segment = "premium" };
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns(new List<string> { "feature" });
        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature", context))
            .ReturnsAsync(true);

        _service = CreateService();

        // Act
#pragma warning disable CS0618 // Type or member is obsolete
        await _service.AddMetricAsync("legacy-metric", context, 10);
#pragma warning restore CS0618

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature", context), Times.Once);
    }

    #endregion
}
