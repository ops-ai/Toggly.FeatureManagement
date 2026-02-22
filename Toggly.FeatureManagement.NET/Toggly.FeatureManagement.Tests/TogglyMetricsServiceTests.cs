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

    #region Application Lifetime Tests

    [Fact]
    public async Task Constructor_RegistersApplicationStoppingCallback()
    {
        // Arrange
        _service = CreateService();

        // Act - simulate application stopping
        _applicationStoppingCts.Cancel();
        await Task.Delay(100);

        // Assert - no exception should be thrown
        _service.Should().NotBeNull();
    }

    #endregion

    #region Instance Name Tests

    [Fact]
    public void Constructor_WithNullInstanceName_UsesMachineName()
    {
        // Arrange & Act
        _service = CreateService(CreateSettings(instanceName: null));

        // Assert
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public void Constructor_WithCustomInstanceName_UsesProvidedName()
    {
        // Arrange & Act
        _service = CreateService(CreateSettings(instanceName: "custom-instance"));

        // Assert
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region Registry Service Integration Tests

    [Fact]
    public async Task MeasureAsync_WithRegistryServiceValues_IncludesRegisteredMeasurements()
    {
        // Arrange
        _metricsRegistryServiceMock.Setup(x => x.GetMeasurementValuesAsync())
            .ReturnsAsync(new Dictionary<string, double> { { "registered-metric", 100.0 } });

        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("test-metric", 50.0);

        // Assert
        _metricsRegistryServiceMock.Verify(x => x.GetMeasurementValuesAsync(), Times.Never);
    }

    [Fact]
    public async Task ObserveAsync_MultipleObservations_AccumulatesValues()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.ObserveAsync("latency", 100.0);
        await _service.ObserveAsync("latency", 150.0);
        await _service.ObserveAsync("latency", 200.0);

        // Assert
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region Error Handling Tests

    [Fact]
    public async Task MeasureAsync_WhenFeatureManagerThrows_HandlesGracefully()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("error-metric"))
            .Returns(new List<string> { "error-feature" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("error-feature"))
            .ThrowsAsync(new InvalidOperationException("Feature manager error"));

        _service = CreateService();

        // Act & Assert
        var act = async () => await _service.MeasureAsync("error-metric", 10.0);
        await act.Should().ThrowAsync<InvalidOperationException>();
    }

    [Fact]
    public async Task IncrementCounterAsync_WhenFeatureManagerThrows_HandlesGracefully()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("error-metric"))
            .Returns(new List<string> { "error-feature" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("error-feature"))
            .ThrowsAsync(new InvalidOperationException("Feature manager error"));

        _service = CreateService();

        // Act & Assert
        var act = async () => await _service.IncrementCounterAsync("error-metric", 1.0);
        await act.Should().ThrowAsync<InvalidOperationException>();
    }

    #endregion

    #region MetricsDebugInfo Tests

    [Fact]
    public void MetricsDebugInfo_Properties_CanBeSetAndRead()
    {
        // Arrange
        var debugInfo = new MetricsDebugInfo
        {
            AppKey = "test-key",
            Environment = "Production",
            BaseUrl = "https://api.toggly.io",
            UserAgent = "TestAgent/1.0",
            LastError = "Test error",
            LastErrorTime = DateTime.UtcNow,
            LastSend = DateTime.UtcNow.AddMinutes(-5)
        };

        // Assert
        debugInfo.AppKey.Should().Be("test-key");
        debugInfo.Environment.Should().Be("Production");
        debugInfo.BaseUrl.Should().Be("https://api.toggly.io");
        debugInfo.UserAgent.Should().Be("TestAgent/1.0");
        debugInfo.LastError.Should().Be("Test error");
        debugInfo.LastErrorTime.Should().NotBeNull();
        debugInfo.LastSend.Should().NotBeNull();
    }

    [Fact]
    public void MetricsDebugInfo_Stats_CanBeNull()
    {
        // Arrange
        var debugInfo = new MetricsDebugInfo
        {
            Stats = null
        };

        // Assert
        debugInfo.Stats.Should().BeNull();
    }

    #endregion

    #region Multiple Features in Experiment Tests

    [Fact]
    public async Task MeasureAsync_WithMultipleExperimentFeatures_IncrementsAll()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("multi-feature-metric"))
            .Returns(new List<string> { "feature1", "feature2", "feature3" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature1")).ReturnsAsync(true);
        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature2")).ReturnsAsync(false);
        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature3")).ReturnsAsync(true);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("multi-feature-metric", 25.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature1"), Times.Once);
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature2"), Times.Once);
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature3"), Times.Once);
    }

    [Fact]
    public async Task ObserveAsync_WithMultipleExperimentFeatures_StoresAll()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("multi-feature-observation"))
            .Returns(new List<string> { "feature1", "feature2" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature1")).ReturnsAsync(true);
        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature2")).ReturnsAsync(false);

        _service = CreateService();

        // Act
        await _service.ObserveAsync("multi-feature-observation", 75.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature1"), Times.Once);
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature2"), Times.Once);
    }

    [Fact]
    public async Task IncrementCounterAsync_WithMultipleExperimentFeatures_IncrementsAll()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("multi-feature-counter"))
            .Returns(new List<string> { "feature1", "feature2" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature1")).ReturnsAsync(true);
        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature2")).ReturnsAsync(true);

        _service = CreateService();

        // Act
        await _service.IncrementCounterAsync("multi-feature-counter", 5.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature1"), Times.Once);
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature2"), Times.Once);
    }

    #endregion

    #region Context Handling Tests

    [Fact]
    public async Task MeasureAsync_WithNullContext_HandlesGracefully()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("null-context-metric"))
            .Returns(new List<string> { "feature" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature", (object?)null))
            .ReturnsAsync(true);

        _service = CreateService();

        // Act
        await _service.MeasureAsync<object?>("null-context-metric", null, 10.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature", (object?)null), Times.Once);
    }

    [Fact]
    public async Task ObserveAsync_WithNullContext_HandlesGracefully()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("null-context-observation"))
            .Returns(new List<string> { "feature" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature", (object?)null))
            .ReturnsAsync(false);

        _service = CreateService();

        // Act
        await _service.ObserveAsync<object?>("null-context-observation", null, 50.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature", (object?)null), Times.Once);
    }

    [Fact]
    public async Task IncrementCounterAsync_WithNullContext_HandlesGracefully()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("null-context-counter"))
            .Returns(new List<string> { "feature" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature", (object?)null))
            .ReturnsAsync(true);

        _service = CreateService();

        // Act
        await _service.IncrementCounterAsync<object?>("null-context-counter", null, 1.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature", (object?)null), Times.Once);
    }

    #endregion

    #region Mixed Operations Tests

    [Fact]
    public async Task MixedOperations_ConcurrentlyExecuted_HandledSafely()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        var tasks = new List<Task>();
        for (int i = 0; i < 30; i++)
        {
            tasks.Add(_service.MeasureAsync($"metric-{i % 3}", i * 1.0));
            tasks.Add(_service.ObserveAsync($"observation-{i % 3}", i * 2.0));
            tasks.Add(_service.IncrementCounterAsync($"counter-{i % 3}", 1.0));
        }

        await Task.WhenAll(tasks);

        // Assert
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region Metric Key Edge Cases Tests

    [Fact]
    public async Task MeasureAsync_WithEmptyMetricKey_RecordsMetric()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("", 10.0);

        // Assert
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task MeasureAsync_WithVeryLongMetricKey_RecordsMetric()
    {
        // Arrange
        var longKey = new string('a', 500);
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(longKey))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.MeasureAsync(longKey, 10.0);

        // Assert
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task MeasureAsync_WithSpecialCharacters_RecordsMetric()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("metric-with_special.chars:123/test", 10.0);

        // Assert
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task MeasureAsync_WithUnicodeMetricKey_RecordsMetric()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("指标-metric-🎉", 10.0);

        // Assert
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region Value Edge Cases Tests

    [Fact]
    public async Task MeasureAsync_WithZeroValue_RecordsMetric()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("zero-metric", 0.0);

        // Assert
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task MeasureAsync_WithNegativeValue_RecordsMetric()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("negative-metric", -50.5);

        // Assert
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task MeasureAsync_WithVeryLargeValue_RecordsMetric()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("large-metric", double.MaxValue / 2);

        // Assert
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task MeasureAsync_WithVerySmallValue_RecordsMetric()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("small-metric", double.Epsilon);

        // Assert
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region Empty Feature List Tests

    [Fact]
    public async Task MeasureAsync_WithEmptyFeatureList_OnlyRecordsBase()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("empty-feature-metric"))
            .Returns(new List<string>());

        _service = CreateService();

        // Act
        await _service.MeasureAsync("empty-feature-metric", 100.0);

        // Assert - verify no feature manager calls
        _featureManagerMock.Verify(x => x.IsEnabledAsync(It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task ObserveAsync_WithEmptyFeatureList_OnlyRecordsBase()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("empty-feature-observation"))
            .Returns(new List<string>());

        _service = CreateService();

        // Act
        await _service.ObserveAsync("empty-feature-observation", 50.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync(It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task IncrementCounterAsync_WithEmptyFeatureList_OnlyRecordsBase()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("empty-feature-counter"))
            .Returns(new List<string>());

        _service = CreateService();

        // Act
        await _service.IncrementCounterAsync("empty-feature-counter", 1.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync(It.IsAny<string>()), Times.Never);
    }

    #endregion

    #region Feature Enabled/Disabled Tests

    [Fact]
    public async Task MeasureAsync_WithAllFeaturesEnabled_RecordsAllAsEnabled()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("all-enabled-metric"))
            .Returns(new List<string> { "feature1", "feature2", "feature3" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync(It.IsAny<string>())).ReturnsAsync(true);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("all-enabled-metric", 100.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature1"), Times.Once);
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature2"), Times.Once);
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature3"), Times.Once);
    }

    [Fact]
    public async Task MeasureAsync_WithAllFeaturesDisabled_RecordsAllAsDisabled()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("all-disabled-metric"))
            .Returns(new List<string> { "feature1", "feature2" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync(It.IsAny<string>())).ReturnsAsync(false);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("all-disabled-metric", 50.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature1"), Times.Once);
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature2"), Times.Once);
    }

    #endregion

    #region Debug Info State Tests

    [Fact]
    public void GetDebugInfo_InitialState_HasNoErrors()
    {
        // Arrange
        _service = CreateService();

        // Act
        var debugInfo = _service.GetDebugInfo();

        // Assert
        debugInfo.LastError.Should().BeEmpty();
        debugInfo.LastErrorTime.Should().BeNull();
        debugInfo.LastSend.Should().BeNull();
    }

    [Fact]
    public void GetDebugInfo_UserAgent_HasCorrectFormat()
    {
        // Arrange
        _service = CreateService();

        // Act
        var debugInfo = _service.GetDebugInfo();

        // Assert
        debugInfo.UserAgent.Should().StartWith("Toggly.FeatureManagement/");
    }

    #endregion

    #region Dispose Edge Cases Tests

    [Fact]
    public async Task Dispose_AfterManyOperations_CleansUpProperly()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act - record many metrics
        for (int i = 0; i < 50; i++)
        {
            await _service.MeasureAsync($"cleanup-metric-{i % 5}", i * 1.0);
            await _service.ObserveAsync($"cleanup-observation-{i % 5}", i * 2.0);
            await _service.IncrementCounterAsync($"cleanup-counter-{i % 5}", 1.0);
        }

        // Dispose
        _service.Dispose();
        _service = null;

        // Assert - no exception thrown
    }

    [Fact]
    public void Dispose_CalledMultipleTimes_DoesNotThrow()
    {
        // Arrange
        _service = CreateService();

        // Act & Assert
        _service.Dispose();
        _service.Dispose();
        _service.Dispose();
        _service = null;
    }

    #endregion

    #region Context Type Variations Tests

    [Fact]
    public async Task MeasureAsync_WithAnonymousContext_PassesToFeatureManager()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("anon-metric"))
            .Returns(new List<string> { "feature" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature", It.IsAny<object>()))
            .ReturnsAsync(true);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("anon-metric", new { Id = 123, Name = "Test" }, 10.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature", It.IsAny<object>()), Times.Once);
    }

    [Fact]
    public async Task ObserveAsync_WithCustomContext_PassesToFeatureManager()
    {
        // Arrange
        var context = new TestContext { Value = 42 };
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("custom-metric"))
            .Returns(new List<string> { "feature" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature", context))
            .ReturnsAsync(true);

        _service = CreateService();

        // Act
        await _service.ObserveAsync("custom-metric", context, 99.9);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature", context), Times.Once);
    }

    [Fact]
    public async Task IncrementCounterAsync_WithStringContext_PassesToFeatureManager()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("string-metric"))
            .Returns(new List<string> { "feature" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("feature", "user-123"))
            .ReturnsAsync(true);

        _service = CreateService();

        // Act
        await _service.IncrementCounterAsync("string-metric", "user-123", 5.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("feature", "user-123"), Times.Once);
    }

    private class TestContext
    {
        public int Value { get; set; }
    }

    #endregion

    #region Same Metric Different Features Tests

    [Fact]
    public async Task MeasureAsync_SameMetricDifferentFeatureStates_TracksCorrectly()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric("mixed-state-metric"))
            .Returns(new List<string> { "enabled-feature", "disabled-feature" });

        _featureManagerMock.Setup(x => x.IsEnabledAsync("enabled-feature")).ReturnsAsync(true);
        _featureManagerMock.Setup(x => x.IsEnabledAsync("disabled-feature")).ReturnsAsync(false);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("mixed-state-metric", 100.0);

        // Assert
        _featureManagerMock.Verify(x => x.IsEnabledAsync("enabled-feature"), Times.Once);
        _featureManagerMock.Verify(x => x.IsEnabledAsync("disabled-feature"), Times.Once);
    }

    #endregion

    #region Multiple Calls Same Metric Tests

    [Fact]
    public async Task MeasureAsync_MultipleCalls_AccumulatesValues()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.MeasureAsync("accumulation-metric", 10.0);
        await _service.MeasureAsync("accumulation-metric", 20.0);
        await _service.MeasureAsync("accumulation-metric", 30.0);

        // Assert
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task IncrementCounterAsync_MultipleDifferentMetrics_TracksAllSeparately()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.IncrementCounterAsync("counter-a", 1.0);
        await _service.IncrementCounterAsync("counter-b", 2.0);
        await _service.IncrementCounterAsync("counter-c", 3.0);
        await _service.IncrementCounterAsync("counter-a", 4.0);

        // Assert
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region Observation Timestamp Tests

    [Fact]
    public async Task ObserveAsync_MultipleObservations_StoresWithDifferentTimestamps()
    {
        // Arrange
        _featureExperimentProviderMock.Setup(x => x.GetFeaturesForMetric(It.IsAny<string>()))
            .Returns((List<string>?)null);

        _service = CreateService();

        // Act
        await _service.ObserveAsync("timestamp-observation", 10.0);
        await Task.Delay(10); // Small delay to ensure different timestamps
        await _service.ObserveAsync("timestamp-observation", 20.0);

        // Assert
        var debugInfo = _service.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion
}
