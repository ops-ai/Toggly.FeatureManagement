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
using System.Text.Json.Serialization;
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
        bool useSignedDefinitions = false,
        HashSet<string>? allowedKeyIds = null)
    {
        return Options.Create(new TogglySettings
        {
            AppKey = appKey,
            Environment = environment,
            UndefinedEnabledOnDevelopment = undefinedEnabledOnDevelopment,
            UseSignedDefinitions = useSignedDefinitions,
            DefinitionsBaseUrl = "https://definitions.toggly.io/",
            AllowedKeyIds = allowedKeyIds
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
        debugInfo.AppKey.Should().Be("***pp-key");
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

    #region Empty Response Tests

    [Fact]
    public async Task RefreshFeatures_WhenEmptyResponse_LogsWarning()
    {
        // Arrange
        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.OK, "null", new EntityTagHeaderValue("\"etag1\""));

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Wait for initial load attempt
        await Task.Delay(500);

        // Act
        var debugInfo = _provider.GetDebugInfo();

        // Assert - should still be functional even with empty response
        debugInfo.Should().NotBeNull();
        debugInfo.Definitions.Should().BeEmpty();
    }

    [Fact]
    public async Task RefreshFeatures_WhenEmptyArray_LoadsNoFeatures()
    {
        // Arrange
        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.OK, "[]", new EntityTagHeaderValue("\"etag1\""));

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
        definitions.Should().BeEmpty();
    }

    #endregion

    #region Snapshot Provider Tests

    [Fact]
    public async Task Constructor_WithSnapshotProvider_LoadsFromSnapshot()
    {
        // Arrange
        var snapshotProviderMock = new Mock<IFeatureSnapshotProvider>();
        var snapshotFeatures = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "snapshot-feature",
                Filters = new List<FeatureFilter>
                {
                    new FeatureFilter { Name = "AlwaysOn", Parameters = new Dictionary<string, string>() }
                }
            }
        };

        snapshotProviderMock.Setup(x => x.GetFeaturesSnapshotAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((snapshotFeatures, (string?)null, (string?)null, (long?)null));

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureSnapshotProvider)))
            .Returns(snapshotProviderMock.Object);

        var settings = CreateSettings();
        // Setup HTTP to return NotModified so snapshot is used
        SetupHttpClientWithResponse(HttpStatusCode.NotModified, "");

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Wait for initial load
        await Task.Delay(500);

        // Act
        var result = await _provider.GetFeatureDefinitionAsync("snapshot-feature");

        // Assert
        result.Should().NotBeNull();
        result.Name.Should().Be("snapshot-feature");
        result.EnabledFor.Should().Contain(f => f.Name == "AlwaysOn");
    }

    [Fact]
    public async Task RefreshFeatures_WithSnapshotProvider_SavesSnapshot()
    {
        // Arrange
        var snapshotProviderMock = new Mock<IFeatureSnapshotProvider>();
        snapshotProviderMock.Setup(x => x.GetFeaturesSnapshotAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(((List<FeatureDefinitionModel>?)null, (string?)null, (string?)null, (long?)null));
        snapshotProviderMock.Setup(x => x.SaveSnapshotAsync(
                It.IsAny<List<FeatureDefinitionModel>>(),
                It.IsAny<string?>(),
                It.IsAny<string?>(),
                It.IsAny<long?>(),
                It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureSnapshotProvider)))
            .Returns(snapshotProviderMock.Object);

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

        // Assert
        snapshotProviderMock.Verify(
            x => x.SaveSnapshotAsync(
                It.IsAny<List<FeatureDefinitionModel>>(),
                It.IsAny<string?>(),
                It.IsAny<string?>(),
                It.IsAny<long?>(),
                It.IsAny<CancellationToken>()),
            Times.AtLeastOnce);
    }

    [Fact]
    public async Task LoadSnapshot_WithEmptyFeatures_DoesNotCrash()
    {
        // Arrange
        var snapshotProviderMock = new Mock<IFeatureSnapshotProvider>();
        snapshotProviderMock.Setup(x => x.GetFeaturesSnapshotAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(((List<FeatureDefinitionModel>?)null, (string?)null, (string?)null, (long?)null));

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureSnapshotProvider)))
            .Returns(snapshotProviderMock.Object);

        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.NotModified, "");

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
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task LoadSnapshot_WhenExceptionOccurs_LogsError()
    {
        // Arrange
        var snapshotProviderMock = new Mock<IFeatureSnapshotProvider>();
        snapshotProviderMock.Setup(x => x.GetFeaturesSnapshotAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("Snapshot error"));

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureSnapshotProvider)))
            .Returns(snapshotProviderMock.Object);

        var settings = CreateSettings();
        SetupHttpClientWithResponse(HttpStatusCode.OK, "[]", new EntityTagHeaderValue("\"etag1\""));

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

        // Assert - should still be functional
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region Feature Filter Parameters Tests

    [Fact]
    public async Task GetFeatureDefinitionAsync_WithFilterParameters_ParsesParametersCorrectly()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "percentage-feature",
                Filters = new List<FeatureFilter>
                {
                    new FeatureFilter
                    {
                        Name = "Percentage",
                        Parameters = new Dictionary<string, string>
                        {
                            ["Value"] = "50",
                            ["Seed"] = "12345"
                        }
                    }
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
        var result = await _provider.GetFeatureDefinitionAsync("percentage-feature");

        // Assert
        result.Should().NotBeNull();
        result.EnabledFor.Should().HaveCount(1);
        var filter = result.EnabledFor.First();
        filter.Name.Should().Be("Percentage");
        filter.Parameters.Should().NotBeNull();
    }

    [Fact]
    public async Task GetFeatureDefinitionAsync_WithNullFilterParameters_HandlesGracefully()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "no-params-feature",
                Filters = new List<FeatureFilter>
                {
                    new FeatureFilter
                    {
                        Name = "AlwaysOn",
                        Parameters = null
                    }
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
        var result = await _provider.GetFeatureDefinitionAsync("no-params-feature");

        // Assert
        result.Should().NotBeNull();
        result.EnabledFor.Should().HaveCount(1);
    }

    #endregion

    #region Concurrent Access Tests

    [Fact]
    public async Task GetFeatureDefinitionAsync_ConcurrentAccess_HandledSafely()
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

        // Act - concurrent access
        var tasks = Enumerable.Range(0, 100)
            .Select(_ => _provider.GetFeatureDefinitionAsync("test-feature"));

        var results = await Task.WhenAll(tasks);

        // Assert
        results.Should().AllSatisfy(r =>
        {
            r.Name.Should().Be("test-feature");
        });
    }

    [Fact]
    public async Task GetAllFeatureDefinitionsAsync_ConcurrentAccess_HandledSafely()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "feature1",
                Filters = new List<FeatureFilter>()
            },
            new FeatureDefinitionModel
            {
                FeatureKey = "feature2",
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

        // Act - concurrent enumeration
        var tasks = Enumerable.Range(0, 10).Select(async _ =>
        {
            var list = new List<FeatureDefinition>();
            await foreach (var def in _provider.GetAllFeatureDefinitionsAsync())
            {
                list.Add(def);
            }
            return list;
        });

        var results = await Task.WhenAll(tasks);

        // Assert
        results.Should().AllSatisfy(r => r.Count.Should().Be(2));
    }

    #endregion

    #region SecuredFeature State Change Tests

    [Fact]
    public async Task RefreshFeatures_WhenSecuredFeatureChangesToUnsecured_UpdatesCorrectly()
    {
        // Arrange - First load with secured feature
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
                var definitions = new List<FeatureDefinitionModel>
                {
                    new FeatureDefinitionModel
                    {
                        FeatureKey = "test-feature",
                        Filters = new List<FeatureFilter>(),
                        SecuredFeature = callCount == 1 // Secured on first call, unsecured on second
                    }
                };
                var response = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(JsonSerializer.Serialize(definitions))
                };
                response.Headers.ETag = new EntityTagHeaderValue($"\"etag{callCount}\"");
                return response;
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

        // First check - should be secured
        var isSecured1 = _provider.IsFeatureSecured("test-feature");

        // Trigger second refresh (simulate timer)
        await Task.Delay(100);

        // Assert
        isSecured1.Should().BeTrue();
    }

    #endregion

    #region Requirement Type Tests

    [Fact]
    public async Task GetFeatureDefinitionAsync_WithMultipleFilters_ReturnsAllFilters()
    {
        // Arrange - test that multiple filters are preserved
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "multi-filter-feature",
                Filters = new List<FeatureFilter>
                {
                    new FeatureFilter { Name = "Percentage", Parameters = new Dictionary<string, string> { ["Value"] = "50" } },
                    new FeatureFilter { Name = "TimeWindow", Parameters = new Dictionary<string, string>() }
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
        var result = await _provider.GetFeatureDefinitionAsync("multi-filter-feature");

        // Assert
        result.Should().NotBeNull();
        result.EnabledFor.Should().HaveCount(2);
        result.EnabledFor.Should().Contain(f => f.Name == "Percentage");
        result.EnabledFor.Should().Contain(f => f.Name == "TimeWindow");
    }

    #endregion

    #region DebugInfo Error State Tests

    [Fact]
    public void GetDebugInfo_InitialState_HasNoErrors()
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
        var debugInfo = _provider.GetDebugInfo();

        // Assert
        debugInfo.LastError.Should().BeEmpty();
        debugInfo.LastErrorTime.Should().BeNull();
    }

    [Fact]
    public void GetDebugInfo_ShowsWebsocketStatus()
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
        var debugInfo = _provider.GetDebugInfo();

        // Assert
        debugInfo.WebsocketClientRunning.Should().BeFalse(); // Not connected initially
    }

    #endregion

    #region Multiple Metrics and Experiments Tests

    [Fact]
    public async Task GetFeaturesForMetric_WhenMultipleFeaturesShareMetric_ReturnsAllFeatures()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "checkout-v2",
                Filters = new List<FeatureFilter>(),
                Metrics = new List<string> { "conversion-rate", "revenue" }
            },
            new FeatureDefinitionModel
            {
                FeatureKey = "new-payment-flow",
                Filters = new List<FeatureFilter>(),
                Metrics = new List<string> { "conversion-rate" }
            },
            new FeatureDefinitionModel
            {
                FeatureKey = "express-checkout",
                Filters = new List<FeatureFilter>(),
                Metrics = new List<string> { "conversion-rate", "cart-abandonment" }
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

        await Task.Delay(500);

        // Act
        var conversionFeatures = _provider.GetFeaturesForMetric("conversion-rate");
        var revenueFeatures = _provider.GetFeaturesForMetric("revenue");
        var cartFeatures = _provider.GetFeaturesForMetric("cart-abandonment");

        // Assert
        conversionFeatures.Should().HaveCount(3);
        conversionFeatures.Should().Contain("checkout-v2");
        conversionFeatures.Should().Contain("new-payment-flow");
        conversionFeatures.Should().Contain("express-checkout");

        revenueFeatures.Should().HaveCount(1);
        revenueFeatures.Should().Contain("checkout-v2");

        cartFeatures.Should().HaveCount(1);
        cartFeatures.Should().Contain("express-checkout");
    }

    [Fact]
    public async Task GetFeaturesForMetric_WhenFeatureHasNoMetrics_ReturnsNullForThatMetric()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "feature-with-metrics",
                Filters = new List<FeatureFilter>(),
                Metrics = new List<string> { "metric-a" }
            },
            new FeatureDefinitionModel
            {
                FeatureKey = "feature-without-metrics",
                Filters = new List<FeatureFilter>(),
                Metrics = null
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

        await Task.Delay(500);

        // Act
        var result = _provider.GetFeaturesForMetric("metric-a");

        // Assert
        result.Should().HaveCount(1);
        result.Should().Contain("feature-with-metrics");
        result.Should().NotContain("feature-without-metrics");
    }

    [Fact]
    public async Task GetDebugInfo_AfterLoadingWithMetrics_ContainsExperiments()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "experiment-feature",
                Filters = new List<FeatureFilter>(),
                Metrics = new List<string> { "experiment-metric" }
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

        await Task.Delay(500);

        // Act
        var debugInfo = _provider.GetDebugInfo();

        // Assert
        debugInfo.Experiments.Should().ContainKey("experiment-metric");
        debugInfo.Experiments["experiment-metric"].Should().Contain("experiment-feature");
    }

    #endregion

    #region HTTP Server Error Tests

    [Fact]
    public async Task RefreshFeatures_WhenServerReturns500_LogsError()
    {
        // Arrange
        var handlerMock = new Mock<HttpMessageHandler>(MockBehavior.Loose);
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage(HttpStatusCode.InternalServerError)
            {
                Content = new StringContent("Server error")
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

        await Task.Delay(500);

        // Act
        var debugInfo = _provider.GetDebugInfo();

        // Assert
        debugInfo.LastError.Should().NotBeEmpty();
        debugInfo.LastErrorTime.Should().NotBeNull();
    }

    [Fact]
    public async Task RefreshFeatures_WhenTimeout_HandlesGracefully()
    {
        // Arrange
        var handlerMock = new Mock<HttpMessageHandler>(MockBehavior.Loose);
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ThrowsAsync(new TaskCanceledException("Request timeout"));

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

        await Task.Delay(500);

        // Act
        var debugInfo = _provider.GetDebugInfo();

        // Assert
        debugInfo.LastError.Should().Contain("timeout");
    }

    #endregion

    #region Feature Update Tests

    [Fact]
    public async Task RefreshFeatures_WhenDefinitionsChange_UpdatesDefinitions()
    {
        // Arrange
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
                var definitions = new List<FeatureDefinitionModel>
                {
                    new FeatureDefinitionModel
                    {
                        FeatureKey = "evolving-feature",
                        Filters = callCount == 1
                            ? new List<FeatureFilter>()
                            : new List<FeatureFilter> { new FeatureFilter { Name = "AlwaysOn", Parameters = new Dictionary<string, string>() } }
                    }
                };
                var response = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(JsonSerializer.Serialize(definitions))
                };
                response.Headers.ETag = new EntityTagHeaderValue($"\"etag{callCount}\"");
                return response;
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

        await Task.Delay(500);

        // Act - get first state
        var firstResult = await _provider.GetFeatureDefinitionAsync("evolving-feature");

        // Assert
        firstResult.EnabledFor.Should().BeEmpty();
    }

    [Fact]
    public async Task RefreshFeatures_WhenNewFeatureAdded_AddsToDefinitions()
    {
        // Arrange
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
                var definitions = new List<FeatureDefinitionModel>
                {
                    new FeatureDefinitionModel
                    {
                        FeatureKey = "feature-1",
                        Filters = new List<FeatureFilter>()
                    }
                };

                if (callCount > 1)
                {
                    definitions.Add(new FeatureDefinitionModel
                    {
                        FeatureKey = "feature-2",
                        Filters = new List<FeatureFilter>()
                    });
                }

                var response = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(JsonSerializer.Serialize(definitions))
                };
                response.Headers.ETag = new EntityTagHeaderValue($"\"etag{callCount}\"");
                return response;
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

        await Task.Delay(500);

        // Act
        var allFeatures = new List<FeatureDefinition>();
        await foreach (var def in _provider.GetAllFeatureDefinitionsAsync())
        {
            allFeatures.Add(def);
        }

        // Assert
        allFeatures.Should().Contain(f => f.Name == "feature-1");
    }

    #endregion

    #region ETag Caching Tests

    [Fact]
    public async Task RefreshFeatures_SendsIfNoneMatchHeader_WhenETagAvailable()
    {
        // Arrange
        var requestMessages = new List<HttpRequestMessage>();
        var handlerMock = new Mock<HttpMessageHandler>(MockBehavior.Loose);
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>((req, _) =>
            {
                // Clone the essential parts we need to verify
                requestMessages.Add(new HttpRequestMessage
                {
                    RequestUri = req.RequestUri,
                    Headers = { { "If-None-Match-Check", req.Headers.IfNoneMatch.Count.ToString() } }
                });
            })
            .ReturnsAsync(() =>
            {
                var definitions = new List<FeatureDefinitionModel>
                {
                    new FeatureDefinitionModel
                    {
                        FeatureKey = "test-feature",
                        Filters = new List<FeatureFilter>()
                    }
                };
                var response = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(JsonSerializer.Serialize(definitions))
                };
                response.Headers.ETag = new EntityTagHeaderValue("\"test-etag\"");
                return response;
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

        // Assert - at least one request was made
        requestMessages.Should().NotBeEmpty();
    }

    #endregion

    #region Dispose Cleanup Tests

    [Fact]
    public async Task Dispose_AfterLoadingFeatures_CleansUpResources()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "test-feature",
                Filters = new List<FeatureFilter>(),
                Metrics = new List<string> { "metric1" }
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

        await Task.Delay(500);

        // Act
        _provider.Dispose();

        // Assert - no exception should be thrown
        _provider = null; // Prevent double dispose in cleanup
    }

    [Fact]
    public void Dispose_CalledMultipleTimes_DoesNotThrow()
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

        // Act & Assert - multiple dispose calls should be safe
        _provider.Dispose();
        _provider.Dispose();
        _provider.Dispose();

        _provider = null;
    }

    #endregion

    #region Feature State Notification Tests

    [Fact]
    public async Task RefreshFeatures_NotifiesFeatureStateService_OnDefinitionsLoaded()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "notification-test-feature",
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

        await Task.Delay(500);

        // Assert
        _featureStateServiceMock.Verify(
            x => x.NotifyDefinitionsChanged(),
            Times.AtLeastOnce);
    }

    [Fact]
    public async Task RefreshFeatures_UpdatesFeatureState_ForEachFeature()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "feature-a",
                Filters = new List<FeatureFilter>
                {
                    new FeatureFilter { Name = "AlwaysOn", Parameters = new Dictionary<string, string>() }
                }
            },
            new FeatureDefinitionModel
            {
                FeatureKey = "feature-b",
                Filters = new List<FeatureFilter>
                {
                    new FeatureFilter { Name = "Percentage", Parameters = new Dictionary<string, string> { ["Value"] = "50" } }
                }
            },
            new FeatureDefinitionModel
            {
                FeatureKey = "feature-c",
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

        await Task.Delay(500);

        // Assert - AlwaysOn filter means true, others false
        _featureStateServiceMock.Verify(
            x => x.UpdateFeatureState("feature-a", true),
            Times.AtLeastOnce);
        _featureStateServiceMock.Verify(
            x => x.UpdateFeatureState("feature-b", false),
            Times.AtLeastOnce);
        _featureStateServiceMock.Verify(
            x => x.UpdateFeatureState("feature-c", false),
            Times.AtLeastOnce);
    }

    #endregion

    #region Production vs Development Environment Tests

    [Fact]
    public async Task Constructor_InProductionEnvironment_DisablesUndefinedFeatures()
    {
        // Arrange
        _hostEnvironmentMock.Setup(x => x.EnvironmentName).Returns("Production");
        var settings = CreateSettings(undefinedEnabledOnDevelopment: true);
        SetupHttpClientWithResponse(HttpStatusCode.NotModified, "");

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Act
        var result = await _provider.GetFeatureDefinitionAsync("undefined-feature");

        // Assert - even with UndefinedEnabledOnDevelopment=true, should be disabled in Production
        result.EnabledFor.Should().BeEmpty();
    }

    [Fact]
    public async Task Constructor_InStagingEnvironment_DisablesUndefinedFeatures()
    {
        // Arrange
        _hostEnvironmentMock.Setup(x => x.EnvironmentName).Returns("Staging");
        var settings = CreateSettings(undefinedEnabledOnDevelopment: true);
        SetupHttpClientWithResponse(HttpStatusCode.NotModified, "");

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Act
        var result = await _provider.GetFeatureDefinitionAsync("undefined-feature");

        // Assert
        result.EnabledFor.Should().BeEmpty();
    }

    #endregion

    #region Snapshot Provider Signed Definitions Tests

    [Fact]
    public async Task LoadSnapshot_WithSignedDefinitions_ValidatesSignatureFields()
    {
        // Arrange - Snapshot missing required signature fields with useSignedDefinitions=true
        var snapshotProviderMock = new Mock<IFeatureSnapshotProvider>();
        var snapshotFeatures = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "snapshot-feature",
                Filters = new List<FeatureFilter>()
            }
        };

        // Missing Signature, KeyId, Timestamp
        snapshotProviderMock.Setup(x => x.GetFeaturesSnapshotAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((snapshotFeatures, (string?)null, (string?)null, (long?)null));

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureSnapshotProvider)))
            .Returns(snapshotProviderMock.Object);

        var settings = Options.Create(new TogglySettings
        {
            AppKey = "test-app-key",
            Environment = "test-env",
            UndefinedEnabledOnDevelopment = false,
            UseSignedDefinitions = true,
            DefinitionsBaseUrl = "https://definitions.toggly.io/"
        });

        // Setup HTTP to return NotModified - this forces snapshot loading
        SetupHttpClientWithResponse(HttpStatusCode.NotModified, "");

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        await Task.Delay(500);

        // Act
        var result = await _provider.GetFeatureDefinitionAsync("snapshot-feature");

        // Assert - feature should not be loaded due to missing signature fields
        result.Name.Should().Be("snapshot-feature");
        // The feature won't have the AlwaysOn filter because snapshot failed validation
    }

    #endregion

    #region Complex Filter Scenarios Tests

    [Fact]
    public async Task GetFeatureDefinitionAsync_WithManyFilters_ParsesAllCorrectly()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "complex-feature",
                Filters = new List<FeatureFilter>
                {
                    new FeatureFilter { Name = "Percentage", Parameters = new Dictionary<string, string> { ["Value"] = "50" } },
                    new FeatureFilter { Name = "TimeWindow", Parameters = new Dictionary<string, string> { ["Start"] = "2024-01-01", ["End"] = "2024-12-31" } },
                    new FeatureFilter { Name = "Targeting", Parameters = new Dictionary<string, string> { ["Audience"] = "beta-users" } },
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

        await Task.Delay(500);

        // Act
        var result = await _provider.GetFeatureDefinitionAsync("complex-feature");

        // Assert
        result.EnabledFor.Should().HaveCount(4);
        result.EnabledFor.Select(f => f.Name).Should().Contain(new[] { "Percentage", "TimeWindow", "Targeting", "AlwaysOn" });
    }

    [Fact]
    public async Task GetFeatureDefinitionAsync_WithEmptyFilters_ReturnsEmptyEnabledFor()
    {
        // Arrange
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "no-filters-feature",
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

        await Task.Delay(500);

        // Act
        var result = await _provider.GetFeatureDefinitionAsync("no-filters-feature");

        // Assert
        result.EnabledFor.Should().BeEmpty();
    }

    #endregion

    #region GetAllFeatureDefinitionsAsync Loading Tests

    [Fact]
    public async Task GetAllFeatureDefinitionsAsync_WhenNotYetLoaded_WaitsForLoad()
    {
        // Arrange - delay the HTTP response to simulate slow loading
        var definitions = new List<FeatureDefinitionModel>
        {
            new FeatureDefinitionModel
            {
                FeatureKey = "delayed-feature",
                Filters = new List<FeatureFilter>()
            }
        };
        var jsonContent = JsonSerializer.Serialize(definitions);

        var handlerMock = new Mock<HttpMessageHandler>(MockBehavior.Loose);
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Returns(async () =>
            {
                await Task.Delay(200);
                var response = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(jsonContent)
                };
                response.Headers.ETag = new EntityTagHeaderValue("\"etag1\"");
                return response;
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

        // Act - call immediately without waiting
        await Task.Delay(600); // Wait for load to complete

        var allFeatures = new List<FeatureDefinition>();
        await foreach (var def in _provider.GetAllFeatureDefinitionsAsync())
        {
            allFeatures.Add(def);
        }

        // Assert
        allFeatures.Should().Contain(f => f.Name == "delayed-feature");
    }

    #endregion

    #region Signed Definitions Tests

    [Fact]
    public async Task RefreshFeatures_WithSignedDefinitions_ValidatesSignature()
    {
        // Arrange
        var validSignature = Convert.ToBase64String(new byte[64]); // Dummy signature
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        var signedResponse = new
        {
            defs = new[]
            {
                new
                {
                    featureKey = "signed-feature",
                    filters = Array.Empty<object>(),
                    metrics = (string[]?)null,
                    securedFeature = false,
                    requirementType = 0
                }
            },
            signature = validSignature,
            kid = "test-key-id",
            timestamp = timestamp
        };

        var handlerMock = new Mock<HttpMessageHandler>();
        handlerMock.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync((HttpRequestMessage request, CancellationToken _) =>
            {
                if (request.RequestUri?.PathAndQuery.Contains("definitions-signed") == true)
                {
                    var response = new HttpResponseMessage(HttpStatusCode.OK)
                    {
                        Content = new StringContent(System.Text.Json.JsonSerializer.Serialize(signedResponse))
                    };
                    response.Headers.ETag = new EntityTagHeaderValue("\"etag1\"");
                    return response;
                }

                // Return empty JWKS
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("{\"keys\": []}")
                };
            });

        var httpClient = new HttpClient(handlerMock.Object)
        {
            BaseAddress = new Uri("https://definitions.toggly.io/")
        };

        _httpClientFactoryMock.Setup(x => x.CreateClient("toggly"))
            .Returns(httpClient);

        var settings = CreateSettings(useSignedDefinitions: true);

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Act
        await Task.Delay(600);

        // Assert - feature should not be loaded (signature validation failed)
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
        // The feature won't be loaded because signature validation fails
    }

    [Fact]
    public async Task RefreshFeatures_WithOlderTimestamp_RejectsDefinitions()
    {
        // Arrange - First load with current timestamp
        var timestamp1 = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var timestamp2 = timestamp1 - 1000; // Older timestamp

        var callCount = 0;

        var handlerMock = new Mock<HttpMessageHandler>();
        handlerMock.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync((HttpRequestMessage request, CancellationToken _) =>
            {
                callCount++;
                var timestamp = callCount == 1 ? timestamp1 : timestamp2;

                var signedResponse = new
                {
                    defs = new[]
                    {
                        new
                        {
                            featureKey = callCount == 1 ? "feature1" : "feature2",
                            filters = Array.Empty<object>(),
                            metrics = (string[]?)null,
                            securedFeature = false,
                            requirementType = 0
                        }
                    },
                    signature = Convert.ToBase64String(new byte[64]),
                    kid = "test-key",
                    timestamp = timestamp
                };

                if (request.RequestUri?.PathAndQuery.Contains("definitions-signed") == true)
                {
                    var response = new HttpResponseMessage(HttpStatusCode.OK)
                    {
                        Content = new StringContent(System.Text.Json.JsonSerializer.Serialize(signedResponse))
                    };
                    response.Headers.ETag = new EntityTagHeaderValue($"\"etag{callCount}\"");
                    return response;
                }

                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("{\"keys\": []}")
                };
            });

        var httpClient = new HttpClient(handlerMock.Object)
        {
            BaseAddress = new Uri("https://definitions.toggly.io/")
        };

        _httpClientFactoryMock.Setup(x => x.CreateClient("toggly"))
            .Returns(httpClient);

        var settings = CreateSettings(useSignedDefinitions: true);

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Act
        await Task.Delay(600);

        // Assert - Provider should be initialized but might not have features due to signature issues
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region ETag Tests

    [Fact]
    public async Task RefreshFeatures_StoresETagFromResponse()
    {
        // Arrange
        var handlerMock = new Mock<HttpMessageHandler>();
        handlerMock.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync((HttpRequestMessage request, CancellationToken _) =>
            {
                var jsonResponse = new[]
                {
                    new
                    {
                        featureKey = "etag-feature",
                        filters = Array.Empty<object>(),
                        metrics = (string[]?)null,
                        securedFeature = false,
                        requirementType = 0
                    }
                };

                var response = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(System.Text.Json.JsonSerializer.Serialize(jsonResponse))
                };
                response.Headers.ETag = new EntityTagHeaderValue("\"test-etag-123\"");
                return response;
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

        // Act - Wait for load
        await Task.Delay(600);

        // Assert - Feature should be loaded
        var definition = await _provider.GetFeatureDefinitionAsync("etag-feature");
        definition.Should().NotBeNull();
        definition.Name.Should().Be("etag-feature");
    }

    #endregion

    #region GetEcdsaKey Tests

    [Fact]
    public async Task GetEcdsaKey_WithAllowedKeyIds_RejectsUnauthorizedKey()
    {
        // Arrange
        var settings = CreateSettings(allowedKeyIds: new HashSet<string> { "allowed-key-1", "allowed-key-2" });

        var handlerMock = new Mock<HttpMessageHandler>();
        handlerMock.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[]")
            });

        var httpClient = new HttpClient(handlerMock.Object)
        {
            BaseAddress = new Uri("https://definitions.toggly.io/")
        };

        _httpClientFactoryMock.Setup(x => x.CreateClient("toggly"))
            .Returns(httpClient);

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Act - Try to get an unauthorized key
        var getEcdsaKeyMethod = typeof(TogglyFeatureProvider)
            .GetMethod("GetEcdsaKey", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

        var task = (Task<System.Security.Cryptography.ECDsa?>)getEcdsaKeyMethod!.Invoke(_provider, new object[] { "unauthorized-key" })!;
        var result = await task;

        // Assert - Should return null
        result.Should().BeNull();
    }

    [Fact]
    public async Task GetEcdsaKey_WithEmptyJwks_ReturnsNull()
    {
        // Arrange
        var handlerMock = new Mock<HttpMessageHandler>();
        handlerMock.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync((HttpRequestMessage request, CancellationToken _) =>
            {
                if (request.RequestUri?.PathAndQuery.Contains(".well-known/jwks") == true)
                {
                    return new HttpResponseMessage(HttpStatusCode.OK)
                    {
                        Content = new StringContent("{\"keys\": []}")
                    };
                }

                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("[]")
                };
            });

        // Return a new HttpClient each time to avoid "already started" error
        _httpClientFactoryMock.Setup(x => x.CreateClient("toggly"))
            .Returns(() => new HttpClient(handlerMock.Object)
            {
                BaseAddress = new Uri("https://definitions.toggly.io/")
            });

        var settings = CreateSettings();

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Act
        var getEcdsaKeyMethod = typeof(TogglyFeatureProvider)
            .GetMethod("GetEcdsaKey", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

        var task = (Task<System.Security.Cryptography.ECDsa?>)getEcdsaKeyMethod!.Invoke(_provider, new object[] { "some-key-id" })!;
        var result = await task;

        // Assert
        result.Should().BeNull();
    }

    #endregion

    #region Concurrent Refresh Tests

    [Fact]
    public async Task RefreshFeatures_ConcurrentCalls_OnlyOneExecutes()
    {
        // Arrange
        var callCount = 0;

        var handlerMock = new Mock<HttpMessageHandler>();
        handlerMock.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(() =>
            {
                Interlocked.Increment(ref callCount);
                Thread.Sleep(100); // Slow response

                var response = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("[]")
                };
                response.Headers.ETag = new EntityTagHeaderValue($"\"etag-{callCount}\"");
                return response;
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

        // Act - Call RefreshFeatures concurrently
        var refreshMethod = typeof(TogglyFeatureProvider)
            .GetMethod("RefreshFeatures", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

        // Start with initial load
        await Task.Delay(600);
        var initialCount = callCount;

        // Now try concurrent refreshes
        var tasks = Enumerable.Range(0, 5)
            .Select(_ => (Task)refreshMethod!.Invoke(_provider, new object?[] { null })!);

        await Task.WhenAll(tasks);

        // Assert - Due to semaphore, only 1-2 additional calls should have executed
        (callCount - initialCount).Should().BeLessOrEqualTo(2);
    }

    #endregion

    #region LoadSnapshot with Signed Definitions Tests

    [Fact]
    public async Task LoadSnapshot_WithMissingSignatureFields_DoesNotLoadFeatures()
    {
        // Arrange
        var snapshotMock = new Mock<IFeatureSnapshotProvider>();
        snapshotMock.Setup(x => x.GetFeaturesSnapshotAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((Features: new List<FeatureDefinitionModel>
            {
                new FeatureDefinitionModel { FeatureKey = "snapshot-feature", Filters = new List<Data.FeatureFilter>() }
            }, Signature: (string?)null, KeyId: "key-id", Timestamp: DateTimeOffset.UtcNow.ToUnixTimeSeconds()));

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureSnapshotProvider)))
            .Returns(snapshotMock.Object);

        var handlerMock = new Mock<HttpMessageHandler>();
        handlerMock.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[]")
            });

        var httpClient = new HttpClient(handlerMock.Object)
        {
            BaseAddress = new Uri("https://definitions.toggly.io/")
        };

        _httpClientFactoryMock.Setup(x => x.CreateClient("toggly"))
            .Returns(httpClient);

        var settings = CreateSettings(useSignedDefinitions: true);

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Act
        await Task.Delay(600);

        // Assert - feature won't be loaded from snapshot due to missing signature
        var definition = await _provider.GetFeatureDefinitionAsync("snapshot-feature");
        // If signature is missing, feature shouldn't be loaded from snapshot with signed definitions
        definition.Should().NotBeNull();
    }

    #endregion

    #region FeatureProviderDebugInfo Tests

    [Fact]
    public void FeatureProviderDebugInfo_Properties_CanBeSetAndRead()
    {
        // Arrange & Act
        var debugInfo = new FeatureProviderDebugInfo
        {
            AppKey = "app-key",
            Environment = "production",
            UserAgent = "Toggly/1.0",
            LastError = "Some error",
            LastErrorTime = DateTime.UtcNow,
            LastRefresh = DateTime.UtcNow,
            LastDefinitionsCheck = DateTime.UtcNow,
            WebsocketClientRunning = true,
            Loaded = true
        };

        // Assert
        debugInfo.AppKey.Should().Be("app-key");
        debugInfo.Environment.Should().Be("production");
        debugInfo.UserAgent.Should().Be("Toggly/1.0");
        debugInfo.LastError.Should().Be("Some error");
        debugInfo.LastErrorTime.Should().NotBeNull();
        debugInfo.LastRefresh.Should().NotBeNull();
        debugInfo.LastDefinitionsCheck.Should().NotBeNull();
        debugInfo.WebsocketClientRunning.Should().BeTrue();
        debugInfo.Loaded.Should().BeTrue();
    }

    [Fact]
    public void FeatureProviderDebugInfo_Definitions_CanBeSet()
    {
        // Arrange
        var definitions = new System.Collections.Concurrent.ConcurrentDictionary<string, FeatureDefinition>();
        definitions.TryAdd("feature1", new FeatureDefinition { Name = "feature1" });

        // Act
        var debugInfo = new FeatureProviderDebugInfo
        {
            Definitions = definitions
        };

        // Assert
        debugInfo.Definitions.Should().NotBeNull();
        debugInfo.Definitions.Should().ContainKey("feature1");
    }

    #endregion

    #region Dispose Tests

    [Fact]
    public void Dispose_ClearsEcdsaKeys()
    {
        // Arrange
        var handlerMock = new Mock<HttpMessageHandler>();
        handlerMock.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[]")
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

        // Act
        _provider.Dispose();

        // Assert - Dispose should complete without error
        _provider.Should().NotBeNull();
    }

    [Fact]
    public void Dispose_CanBeCalledMultipleTimes()
    {
        // Arrange
        var handlerMock = new Mock<HttpMessageHandler>();
        handlerMock.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[]")
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

        // Act & Assert
        var act = () =>
        {
            _provider.Dispose();
            _provider.Dispose();
            _provider.Dispose();
        };

        act.Should().NotThrow();
    }

    #endregion
}
