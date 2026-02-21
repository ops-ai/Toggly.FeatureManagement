using FluentAssertions;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using Moq;
using System.Collections.Concurrent;
using Toggly.FeatureManagement.HealthChecks;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class TogglyHealthCheckTests
{
    private readonly Mock<IFeatureDefinitionProvider> _featureProviderMock;
    private readonly Mock<IFeatureProviderDebug> _featureProviderDebugMock;

    public TogglyHealthCheckTests()
    {
        _featureProviderDebugMock = new Mock<IFeatureProviderDebug>();
        _featureProviderMock = _featureProviderDebugMock.As<IFeatureDefinitionProvider>();
    }

    private TogglyHealthCheck CreateHealthCheck(TogglyHealthCheckOptions? options = null)
    {
        return new TogglyHealthCheck(
            _featureProviderMock.Object,
            Options.Create(options ?? new TogglyHealthCheckOptions()));
    }

    private HealthCheckContext CreateContext(HealthStatus failureStatus = HealthStatus.Unhealthy)
    {
        return new HealthCheckContext
        {
            Registration = new HealthCheckRegistration("Toggly", CreateHealthCheck(), failureStatus, null)
        };
    }

    #region Constructor Tests

    [Fact]
    public void Constructor_ThrowsArgumentException_WhenProviderDoesNotImplementDebug()
    {
        // Arrange
        var nonDebugProvider = new Mock<IFeatureDefinitionProvider>();

        // Act & Assert
        var act = () => new TogglyHealthCheck(
            nonDebugProvider.Object,
            Options.Create(new TogglyHealthCheckOptions()));

        act.Should().Throw<ArgumentException>()
            .WithMessage("*IFeatureProviderDebug*");
    }

    #endregion

    #region SDK Not Loaded Tests

    [Fact]
    public async Task CheckHealthAsync_ReturnsUnhealthy_WhenSdkNotLoaded()
    {
        // Arrange
        _featureProviderDebugMock.Setup(x => x.GetDebugInfo()).Returns(new FeatureProviderDebugInfo
        {
            Loaded = false,
            WebsocketClientRunning = false
        });

        var healthCheck = CreateHealthCheck();
        var context = CreateContext();

        // Act
        var result = await healthCheck.CheckHealthAsync(context);

        // Assert
        result.Status.Should().Be(HealthStatus.Unhealthy);
        result.Description.Should().Contain("not completed initial load");
    }

    #endregion

    #region Healthy Status Tests

    [Fact]
    public async Task CheckHealthAsync_ReturnsHealthy_WhenLoadedAndWebSocketConnected()
    {
        // Arrange
        _featureProviderDebugMock.Setup(x => x.GetDebugInfo()).Returns(new FeatureProviderDebugInfo
        {
            Loaded = true,
            WebsocketClientRunning = true,
            Definitions = new ConcurrentDictionary<string, FeatureDefinition>(),
            LastDefinitionsCheck = DateTime.UtcNow
        });

        var healthCheck = CreateHealthCheck();
        var context = CreateContext();

        // Act
        var result = await healthCheck.CheckHealthAsync(context);

        // Assert
        result.Status.Should().Be(HealthStatus.Healthy);
        result.Description.Should().Contain("healthy");
    }

    [Fact]
    public async Task CheckHealthAsync_ReturnsHealthy_WhenWebSocketDisconnectedButDefinitionsFresh()
    {
        // Arrange
        _featureProviderDebugMock.Setup(x => x.GetDebugInfo()).Returns(new FeatureProviderDebugInfo
        {
            Loaded = true,
            WebsocketClientRunning = false,
            LastDefinitionsCheck = DateTime.UtcNow.AddMinutes(-5), // Within 10 minute threshold
            Definitions = new ConcurrentDictionary<string, FeatureDefinition>()
        });

        var healthCheck = CreateHealthCheck();
        var context = CreateContext();

        // Act
        var result = await healthCheck.CheckHealthAsync(context);

        // Assert
        result.Status.Should().Be(HealthStatus.Healthy);
    }

    #endregion

    #region Staleness Tests

    [Fact]
    public async Task CheckHealthAsync_ReturnsUnhealthy_WhenWebSocketDisconnectedAndDefinitionsStale()
    {
        // Arrange
        _featureProviderDebugMock.Setup(x => x.GetDebugInfo()).Returns(new FeatureProviderDebugInfo
        {
            Loaded = true,
            WebsocketClientRunning = false,
            LastDefinitionsCheck = DateTime.UtcNow.AddMinutes(-15), // Beyond 10 minute threshold
            Definitions = new ConcurrentDictionary<string, FeatureDefinition>()
        });

        var healthCheck = CreateHealthCheck();
        var context = CreateContext();

        // Act
        var result = await healthCheck.CheckHealthAsync(context);

        // Assert
        result.Status.Should().Be(HealthStatus.Unhealthy);
        result.Description.Should().Contain("stale");
        result.Description.Should().Contain("WebSocket is disconnected");
    }

    [Fact]
    public async Task CheckHealthAsync_ReturnsUnhealthy_WhenNoDefinitionsCheckAndWebSocketDisconnected()
    {
        // Arrange
        _featureProviderDebugMock.Setup(x => x.GetDebugInfo()).Returns(new FeatureProviderDebugInfo
        {
            Loaded = true,
            WebsocketClientRunning = false,
            LastDefinitionsCheck = null,
            Definitions = new ConcurrentDictionary<string, FeatureDefinition>()
        });

        var healthCheck = CreateHealthCheck();
        var context = CreateContext();

        // Act
        var result = await healthCheck.CheckHealthAsync(context);

        // Assert
        result.Status.Should().Be(HealthStatus.Unhealthy);
    }

    #endregion

    #region Required Features Tests

    [Fact]
    public async Task CheckHealthAsync_ReturnsDegraded_WhenRequiredFeatureDisabled()
    {
        // Arrange
        var definitions = new ConcurrentDictionary<string, FeatureDefinition>();
        definitions["OtherFeature"] = new FeatureDefinition
        {
            Name = "OtherFeature",
            EnabledFor = new List<FeatureFilterConfiguration>
            {
                new() { Name = "AlwaysOn" }
            }
        };

        _featureProviderDebugMock.Setup(x => x.GetDebugInfo()).Returns(new FeatureProviderDebugInfo
        {
            Loaded = true,
            WebsocketClientRunning = true,
            Definitions = definitions
        });

        var options = new TogglyHealthCheckOptions
        {
            RequiredFeatures = new[] { "RequiredFeature" }
        };

        var healthCheck = CreateHealthCheck(options);
        var context = CreateContext();

        // Act
        var result = await healthCheck.CheckHealthAsync(context);

        // Assert
        result.Status.Should().Be(HealthStatus.Degraded);
        result.Description.Should().Contain("RequiredFeature");
    }

    [Fact]
    public async Task CheckHealthAsync_ReturnsUnhealthy_WhenRequiredFeatureDisabled_AndTreatAsUnhealthy()
    {
        // Arrange
        _featureProviderDebugMock.Setup(x => x.GetDebugInfo()).Returns(new FeatureProviderDebugInfo
        {
            Loaded = true,
            WebsocketClientRunning = true,
            Definitions = new ConcurrentDictionary<string, FeatureDefinition>()
        });

        var options = new TogglyHealthCheckOptions
        {
            RequiredFeatures = new[] { "RequiredFeature" },
            TreatRequiredFeaturesAsUnhealthy = true
        };

        var healthCheck = CreateHealthCheck(options);
        var context = CreateContext();

        // Act
        var result = await healthCheck.CheckHealthAsync(context);

        // Assert
        result.Status.Should().Be(HealthStatus.Unhealthy);
    }

    [Fact]
    public async Task CheckHealthAsync_ReturnsHealthy_WhenRequiredFeatureEnabled()
    {
        // Arrange
        var definitions = new ConcurrentDictionary<string, FeatureDefinition>();
        definitions["RequiredFeature"] = new FeatureDefinition
        {
            Name = "RequiredFeature",
            EnabledFor = new List<FeatureFilterConfiguration>
            {
                new() { Name = "AlwaysOn" }
            }
        };

        _featureProviderDebugMock.Setup(x => x.GetDebugInfo()).Returns(new FeatureProviderDebugInfo
        {
            Loaded = true,
            WebsocketClientRunning = true,
            Definitions = definitions
        });

        var options = new TogglyHealthCheckOptions
        {
            RequiredFeatures = new[] { "RequiredFeature" }
        };

        var healthCheck = CreateHealthCheck(options);
        var context = CreateContext();

        // Act
        var result = await healthCheck.CheckHealthAsync(context);

        // Assert
        result.Status.Should().Be(HealthStatus.Healthy);
    }

    [Fact]
    public async Task CheckHealthAsync_ReturnsHealthy_WhenEmptyRequiredFeaturesList()
    {
        // Arrange
        _featureProviderDebugMock.Setup(x => x.GetDebugInfo()).Returns(new FeatureProviderDebugInfo
        {
            Loaded = true,
            WebsocketClientRunning = true,
            Definitions = new ConcurrentDictionary<string, FeatureDefinition>()
        });

        var options = new TogglyHealthCheckOptions
        {
            RequiredFeatures = Array.Empty<string>()
        };

        var healthCheck = CreateHealthCheck(options);
        var context = CreateContext();

        // Act
        var result = await healthCheck.CheckHealthAsync(context);

        // Assert
        result.Status.Should().Be(HealthStatus.Healthy);
    }

    #endregion

    #region Diagnostic Data Tests

    [Fact]
    public async Task CheckHealthAsync_IncludesDiagnosticData_WhenEnabled()
    {
        // Arrange
        _featureProviderDebugMock.Setup(x => x.GetDebugInfo()).Returns(new FeatureProviderDebugInfo
        {
            Loaded = true,
            WebsocketClientRunning = true,
            AppKey = "test-app-key-12345",
            Environment = "Production",
            Definitions = new ConcurrentDictionary<string, FeatureDefinition>(),
            LastDefinitionsCheck = DateTime.UtcNow
        });

        var options = new TogglyHealthCheckOptions
        {
            IncludeDiagnosticData = true
        };

        var healthCheck = CreateHealthCheck(options);
        var context = CreateContext();

        // Act
        var result = await healthCheck.CheckHealthAsync(context);

        // Assert
        result.Data.Should().ContainKey("appKey");
        result.Data.Should().ContainKey("environment");
        result.Data.Should().ContainKey("definitionCount");
        result.Data.Should().ContainKey("websocketConnected");
        result.Data.Should().ContainKey("loaded");
    }

    [Fact]
    public async Task CheckHealthAsync_ExcludesDiagnosticData_WhenDisabled()
    {
        // Arrange
        _featureProviderDebugMock.Setup(x => x.GetDebugInfo()).Returns(new FeatureProviderDebugInfo
        {
            Loaded = true,
            WebsocketClientRunning = true,
            AppKey = "test-key",
            Definitions = new ConcurrentDictionary<string, FeatureDefinition>()
        });

        var options = new TogglyHealthCheckOptions
        {
            IncludeDiagnosticData = false
        };

        var healthCheck = CreateHealthCheck(options);
        var context = CreateContext();

        // Act
        var result = await healthCheck.CheckHealthAsync(context);

        // Assert
        result.Data.Should().NotContainKey("appKey");
        result.Data.Should().NotContainKey("environment");
    }

    #endregion

    #region MaskAppKey Tests

    [Fact]
    public async Task CheckHealthAsync_MasksAppKey_ShowsOnlyLast6Characters()
    {
        // Arrange
        _featureProviderDebugMock.Setup(x => x.GetDebugInfo()).Returns(new FeatureProviderDebugInfo
        {
            Loaded = true,
            WebsocketClientRunning = true,
            AppKey = "my-secret-app-key-123456",
            Definitions = new ConcurrentDictionary<string, FeatureDefinition>()
        });

        var options = new TogglyHealthCheckOptions
        {
            IncludeDiagnosticData = true
        };

        var healthCheck = CreateHealthCheck(options);
        var context = CreateContext();

        // Act
        var result = await healthCheck.CheckHealthAsync(context);

        // Assert
        result.Data["appKey"].Should().Be("*** 123456");
    }

    [Fact]
    public async Task CheckHealthAsync_MasksAppKey_ReturnsUnknown_WhenNull()
    {
        // Arrange
        _featureProviderDebugMock.Setup(x => x.GetDebugInfo()).Returns(new FeatureProviderDebugInfo
        {
            Loaded = true,
            WebsocketClientRunning = true,
            AppKey = null,
            Definitions = new ConcurrentDictionary<string, FeatureDefinition>()
        });

        var options = new TogglyHealthCheckOptions
        {
            IncludeDiagnosticData = true
        };

        var healthCheck = CreateHealthCheck(options);
        var context = CreateContext();

        // Act
        var result = await healthCheck.CheckHealthAsync(context);

        // Assert
        result.Data["appKey"].Should().Be("unknown");
    }

    [Fact]
    public async Task CheckHealthAsync_MasksAppKey_ShortKey_ShowsFull()
    {
        // Arrange
        _featureProviderDebugMock.Setup(x => x.GetDebugInfo()).Returns(new FeatureProviderDebugInfo
        {
            Loaded = true,
            WebsocketClientRunning = true,
            AppKey = "abc",
            Definitions = new ConcurrentDictionary<string, FeatureDefinition>()
        });

        var options = new TogglyHealthCheckOptions
        {
            IncludeDiagnosticData = true
        };

        var healthCheck = CreateHealthCheck(options);
        var context = CreateContext();

        // Act
        var result = await healthCheck.CheckHealthAsync(context);

        // Assert
        result.Data["appKey"].Should().Be("abc");
    }

    #endregion
}
