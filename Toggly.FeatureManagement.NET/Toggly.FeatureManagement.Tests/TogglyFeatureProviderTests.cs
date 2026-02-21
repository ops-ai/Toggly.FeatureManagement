using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using Moq;
using Moq.Protected;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Toggly.FeatureManagement.Data;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class TogglyFeatureProviderTests : IDisposable
{
    private readonly Mock<ILoggerFactory> _loggerFactoryMock;
    private readonly Mock<IHttpClientFactory> _httpClientFactoryMock;
    private readonly Mock<IHostEnvironment> _hostEnvironmentMock;
    private readonly Mock<IServiceProvider> _serviceProviderMock;
    private readonly Mock<IFeatureStateInternalService> _featureStateServiceMock;
    private readonly Mock<IMetricsService> _metricsServiceMock;
    private TogglyFeatureProvider? _provider;

    public TogglyFeatureProviderTests()
    {
        _loggerFactoryMock = new Mock<ILoggerFactory>();
        _loggerFactoryMock.Setup(x => x.CreateLogger(It.IsAny<string>()))
            .Returns(new Mock<ILogger>().Object);

        _httpClientFactoryMock = new Mock<IHttpClientFactory>();
        _hostEnvironmentMock = new Mock<IHostEnvironment>();
        _hostEnvironmentMock.Setup(x => x.EnvironmentName).Returns("Production");

        _featureStateServiceMock = new Mock<IFeatureStateInternalService>();
        _metricsServiceMock = new Mock<IMetricsService>();

        _serviceProviderMock = new Mock<IServiceProvider>();
        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureSnapshotProvider)))
            .Returns((IFeatureSnapshotProvider?)null);
        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureStateInternalService)))
            .Returns(_featureStateServiceMock.Object);
        _serviceProviderMock.Setup(x => x.GetService(typeof(IMetricsService)))
            .Returns(_metricsServiceMock.Object);
    }

    public void Dispose()
    {
        _provider?.Dispose();
    }

    private IOptions<TogglySettings> CreateSettings(
        string appKey = "test-app-key",
        string environment = "test-env",
        bool undefinedEnabledOnDevelopment = false,
        bool useSignedDefinitions = false)
    {
        return Options.Create(new TogglySettings
        {
            AppKey = appKey,
            Environment = environment,
            UndefinedEnabledOnDevelopment = undefinedEnabledOnDevelopment,
            UseSignedDefinitions = useSignedDefinitions,
            DefinitionsBaseUrl = "https://definitions.toggly.io/"
        });
    }

    private Mock<HttpMessageHandler> SetupHttpClientWithResponse(
        HttpStatusCode statusCode,
        string content,
        EntityTagHeaderValue? etag = null)
    {
        var handlerMock = new Mock<HttpMessageHandler>(MockBehavior.Loose);
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(() =>
            {
                var response = new HttpResponseMessage(statusCode)
                {
                    Content = new StringContent(content)
                };
                if (etag != null)
                {
                    response.Headers.ETag = etag;
                }
                return response;
            });

        var httpClient = new HttpClient(handlerMock.Object)
        {
            BaseAddress = new Uri("https://definitions.toggly.io/")
        };

        _httpClientFactoryMock.Setup(x => x.CreateClient("toggly"))
            .Returns(httpClient);

        return handlerMock;
    }

    #region GetFeatureDefinitionAsync Tests

    [Fact]
    public async Task GetFeatureDefinitionAsync_WhenFeatureNotLoaded_ReturnsDefaultDisabled()
    {
        // Arrange
        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.NotModified, "");

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Act
        var result = await _provider.GetFeatureDefinitionAsync("unknown-feature");

        // Assert - should return default definition with empty EnabledFor
        result.Should().NotBeNull();
        result.Name.Should().Be("unknown-feature");
        result.EnabledFor.Should().BeEmpty();
    }

    [Fact]
    public async Task GetFeatureDefinitionAsync_WithUndefinedEnabledOnDevelopment_ReturnsAlwaysOn()
    {
        // Arrange
        _hostEnvironmentMock.Setup(x => x.EnvironmentName).Returns("Development");
        var settings = CreateSettings(undefinedEnabledOnDevelopment: true);
        SetupHttpClientWithResponse(HttpStatusCode.NotModified, "");

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Act
        var result = await _provider.GetFeatureDefinitionAsync("unknown-feature");

        // Assert
        result.Should().NotBeNull();
        result.Name.Should().Be("unknown-feature");
        result.EnabledFor.Should().Contain(f => f.Name == "AlwaysOn");
    }

    [Fact]
    public async Task GetFeatureDefinitionAsync_WhenFeatureLoaded_ReturnsDefinition()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "test-feature",
                Filters = new List<FeatureFilter>
                {
                    new FeatureFilter { Name = "AlwaysOn", Parameters = new Dictionary<string, string>() }
                }
            }
        };
        var jsonContent = JsonSerializer.Serialize(definitions);

        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.OK, jsonContent, new EntityTagHeaderValue("\"etag1\""));

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Wait for initial load
        await Task.Delay(500);

        // Act
        var result = await _provider.GetFeatureDefinitionAsync("test-feature");

        // Assert
        result.Should().NotBeNull();
        result.Name.Should().Be("test-feature");
        result.EnabledFor.Should().Contain(f => f.Name == "AlwaysOn");
    }

    #endregion

    #region GetAllFeatureDefinitionsAsync Tests

    [Fact]
    public async Task GetAllFeatureDefinitionsAsync_WhenNoFeaturesLoaded_ReturnsEmpty()
    {
        // Arrange
        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.NotModified, "");

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Act
        var definitions = new List<FeatureDefinition>();
        await foreach (var def in _provider.GetAllFeatureDefinitionsAsync())
        {
            definitions.Add(def);
        }

        // Assert
        definitions.Should().BeEmpty();
    }

    [Fact]
    public async Task GetAllFeatureDefinitionsAsync_WhenFeaturesLoaded_ReturnsAllDefinitions()
    {
        // Arrange
        var featureDefinitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "feature1",
                Filters = new List<FeatureFilter>
                {
                    new FeatureFilter { Name = "AlwaysOn", Parameters = new Dictionary<string, string>() }
                }
            },
            new FeatureDefinitionModel
            {
                FeatureKey = "feature2",
                Filters = new List<FeatureFilter>
                {
                    new FeatureFilter { Name = "Percentage", Parameters = new Dictionary<string, string> { ["Value"] = "50" } }
                }
            }
        };
        var jsonContent = JsonSerializer.Serialize(featureDefinitions);

        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.OK, jsonContent, new EntityTagHeaderValue("\"etag1\""));

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Wait for initial load
        await Task.Delay(500);

        // Act
        var definitions = new List<FeatureDefinition>();
        await foreach (var def in _provider.GetAllFeatureDefinitionsAsync())
        {
            definitions.Add(def);
        }

        // Assert
        definitions.Should().HaveCount(2);
        definitions.Should().Contain(d => d.Name == "feature1");
        definitions.Should().Contain(d => d.Name == "feature2");
    }

    #endregion

    #region GetFeaturesForMetric Tests

    [Fact]
    public async Task GetFeaturesForMetric_WhenMetricNotFound_ReturnsNull()
    {
        // Arrange
        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.NotModified, "");

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Act
        var result = _provider.GetFeaturesForMetric("unknown-metric");

        // Assert
        result.Should().BeNull();
    }

    [Fact]
    public async Task GetFeaturesForMetric_WhenMetricHasFeatures_ReturnsFeatureList()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "feature1",
                Filters = new List<FeatureFilter>(),
                Metrics = new List<string> { "conversion-rate" }
            },
            new FeatureDefinitionModel
            {
                FeatureKey = "feature2",
                Filters = new List<FeatureFilter>(),
                Metrics = new List<string> { "conversion-rate", "page-views" }
            },
            new FeatureDefinitionModel
            {
                FeatureKey = "feature3",
                Filters = new List<FeatureFilter>(),
                Metrics = new List<string> { "page-views" }
            }
        };
        var jsonContent = JsonSerializer.Serialize(definitions);

        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.OK, jsonContent, new EntityTagHeaderValue("\"etag1\""));

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Wait for initial load
        await Task.Delay(500);

        // Act
        var result = _provider.GetFeaturesForMetric("conversion-rate");

        // Assert
        result.Should().NotBeNull();
        result.Should().HaveCount(2);
        result.Should().Contain("feature1");
        result.Should().Contain("feature2");
    }

    #endregion

    #region GetDebugInfo Tests

    [Fact]
    public void GetDebugInfo_ReturnsValidDebugInfo()
    {
        // Arrange
        var settings = CreateSettings(appKey: "my-app-key", environment: "staging");
        SetupHttpClientWithResponse(HttpStatusCode.NotModified, "");

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Act
        var debugInfo = _provider.GetDebugInfo();

        // Assert
        debugInfo.Should().NotBeNull();
        debugInfo.AppKey.Should().Be("my-app-key");
        debugInfo.Environment.Should().Be("staging");
        debugInfo.Definitions.Should().NotBeNull();
        debugInfo.Experiments.Should().NotBeNull();
        debugInfo.UserAgent.Should().Contain("Toggly.FeatureManagement");
    }

    [Fact]
    public async Task GetDebugInfo_AfterSuccessfulLoad_ShowsLoadedTrue()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "test-feature",
                Filters = new List<FeatureFilter>()
            }
        };
        var jsonContent = JsonSerializer.Serialize(definitions);

        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.OK, jsonContent, new EntityTagHeaderValue("\"etag1\""));

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Wait for initial load
        await Task.Delay(500);

        // Act
        var debugInfo = _provider.GetDebugInfo();

        // Assert
        debugInfo.Loaded.Should().BeTrue();
        debugInfo.LastRefresh.Should().NotBeNull();
        debugInfo.LastDefinitionsCheck.Should().NotBeNull();
    }

    #endregion

    #region IsFeatureSecured Tests

    [Fact]
    public async Task IsFeatureSecured_WhenFeatureNotSecured_ReturnsFalse()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "test-feature",
                Filters = new List<FeatureFilter>(),
                SecuredFeature = false
            }
        };
        var jsonContent = JsonSerializer.Serialize(definitions);

        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.OK, jsonContent, new EntityTagHeaderValue("\"etag1\""));

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Wait for initial load
        await Task.Delay(500);

        // Act
        var result = _provider.IsFeatureSecured("test-feature");

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public async Task IsFeatureSecured_WhenFeatureSecured_ReturnsTrue()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "secure-feature",
                Filters = new List<FeatureFilter>(),
                SecuredFeature = true
            }
        };
        var jsonContent = JsonSerializer.Serialize(definitions);

        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.OK, jsonContent, new EntityTagHeaderValue("\"etag1\""));

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Wait for initial load
        await Task.Delay(500);

        // Act
        var result = _provider.IsFeatureSecured("secure-feature");

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void IsFeatureSecured_WhenFeatureUnknown_ReturnsFalse()
    {
        // Arrange
        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.NotModified, "");

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Act
        var result = _provider.IsFeatureSecured("unknown-feature");

        // Assert
        result.Should().BeFalse();
    }

    #endregion

    #region Dispose Tests

    [Fact]
    public void Dispose_DisposesResources()
    {
        // Arrange
        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.NotModified, "");

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Act
        _provider.Dispose();

        // Assert - no exception should be thrown
        // Calling dispose again should also be safe
        _provider.Dispose();
        _provider = null; // Prevent double dispose in cleanup
    }

    #endregion

    #region HTTP Error Handling Tests

    [Fact]
    public async Task RefreshFeatures_WhenHttpError_LogsError()
    {
        // Arrange - use Loose behavior to avoid issues with Dispose
        var handlerMock = new Mock<HttpMessageHandler>(MockBehavior.Loose);
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("Network error"));

        var httpClient = new HttpClient(handlerMock.Object)
        {
            BaseAddress = new Uri("https://definitions.toggly.io/")
        };

        _httpClientFactoryMock.Setup(x => x.CreateClient("toggly"))
            .Returns(httpClient);

        var settings = CreateSettings();

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Wait for timer to trigger
        await Task.Delay(500);

        // Act
        var debugInfo = _provider.GetDebugInfo();

        // Assert
        debugInfo.LastError.Should().Contain("Network error");
        debugInfo.LastErrorTime.Should().NotBeNull();
    }

    [Fact]
    public async Task RefreshFeatures_WhenNotModified_DoesNotUpdateDefinitions()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "test-feature",
                Filters = new List<FeatureFilter>()
            }
        };
        var jsonContent = JsonSerializer.Serialize(definitions);

        var callCount = 0;
        var handlerMock = new Mock<HttpMessageHandler>(MockBehavior.Loose);
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(() =>
            {
                callCount++;
                if (callCount == 1)
                {
                    var response = new HttpResponseMessage(HttpStatusCode.OK)
                    {
                        Content = new StringContent(jsonContent)
                    };
                    response.Headers.ETag = new EntityTagHeaderValue("\"etag1\"");
                    return response;
                }
                return new HttpResponseMessage(HttpStatusCode.NotModified);
            });

        var httpClient = new HttpClient(handlerMock.Object)
        {
            BaseAddress = new Uri("https://definitions.toggly.io/")
        };

        _httpClientFactoryMock.Setup(x => x.CreateClient("toggly"))
            .Returns(httpClient);

        var settings = CreateSettings();

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Wait for initial load
        await Task.Delay(500);

        // Act - get debug info after NotModified response
        var debugInfo = _provider.GetDebugInfo();

        // Assert
        debugInfo.Loaded.Should().BeTrue();
        debugInfo.Definitions.Should().ContainKey("test-feature");
    }

    #endregion

    #region Feature State Service Integration Tests

    [Fact]
    public async Task RefreshFeatures_UpdatesFeatureStateService()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "always-on-feature",
                Filters = new List<FeatureFilter>
                {
                    new FeatureFilter { Name = "AlwaysOn", Parameters = new Dictionary<string, string>() }
                }
            },
            new FeatureDefinitionModel
            {
                FeatureKey = "percentage-feature",
                Filters = new List<FeatureFilter>
                {
                    new FeatureFilter { Name = "Percentage", Parameters = new Dictionary<string, string> { ["Value"] = "50" } }
                }
            }
        };
        var jsonContent = JsonSerializer.Serialize(definitions);

        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.OK, jsonContent, new EntityTagHeaderValue("\"etag1\""));

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Wait for initial load
        await Task.Delay(500);

        // Assert
        _featureStateServiceMock.Verify(
            x => x.UpdateFeatureState("always-on-feature", true),
            Times.AtLeastOnce);
        _featureStateServiceMock.Verify(
            x => x.UpdateFeatureState("percentage-feature", false),
            Times.AtLeastOnce);
        _featureStateServiceMock.Verify(
            x => x.NotifyDefinitionsChanged(),
            Times.AtLeastOnce);
    }

    #endregion
}
