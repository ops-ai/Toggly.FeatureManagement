using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using Moq;
using Toggly.FeatureManagement.HealthChecks;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class HealthChecksBuilderExtensionsTests
{
    #region AddTogglyHealthCheck Basic Tests

    [Fact]
    public void AddTogglyHealthCheck_WithDefaults_RegistersHealthCheck()
    {
        // Arrange
        var services = new ServiceCollection();
        RegisterRequiredServices(services);

        // Act
        services.AddHealthChecks()
            .AddTogglyHealthCheck();

        var serviceProvider = services.BuildServiceProvider();
        var healthCheckService = serviceProvider.GetService<HealthCheckService>();

        // Assert
        healthCheckService.Should().NotBeNull();
    }

    [Fact]
    public void AddTogglyHealthCheck_WithCustomName_RegistersWithCustomName()
    {
        // Arrange
        var services = new ServiceCollection();
        RegisterRequiredServices(services);

        // Act
        services.AddHealthChecks()
            .AddTogglyHealthCheck(name: "custom-toggly-check");

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<HealthCheckServiceOptions>>();

        // Assert
        options.Should().NotBeNull();
        options!.Value.Registrations.Should().Contain(r => r.Name == "custom-toggly-check");
    }

    [Fact]
    public void AddTogglyHealthCheck_WithDefaultName_RegistersAsToggly()
    {
        // Arrange
        var services = new ServiceCollection();
        RegisterRequiredServices(services);

        // Act
        services.AddHealthChecks()
            .AddTogglyHealthCheck();

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<HealthCheckServiceOptions>>();

        // Assert
        options.Should().NotBeNull();
        options!.Value.Registrations.Should().Contain(r => r.Name == "toggly");
    }

    [Fact]
    public void AddTogglyHealthCheck_WithFailureStatus_SetsCorrectStatus()
    {
        // Arrange
        var services = new ServiceCollection();
        RegisterRequiredServices(services);

        // Act
        services.AddHealthChecks()
            .AddTogglyHealthCheck(failureStatus: HealthStatus.Degraded);

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<HealthCheckServiceOptions>>();

        // Assert
        options.Should().NotBeNull();
        var registration = options!.Value.Registrations.FirstOrDefault(r => r.Name == "toggly");
        registration.Should().NotBeNull();
        registration!.FailureStatus.Should().Be(HealthStatus.Degraded);
    }

    [Fact]
    public void AddTogglyHealthCheck_WithTags_RegistersWithTags()
    {
        // Arrange
        var services = new ServiceCollection();
        RegisterRequiredServices(services);
        var tags = new[] { "feature-flags", "toggly", "critical" };

        // Act
        services.AddHealthChecks()
            .AddTogglyHealthCheck(tags: tags);

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<HealthCheckServiceOptions>>();

        // Assert
        options.Should().NotBeNull();
        var registration = options!.Value.Registrations.FirstOrDefault(r => r.Name == "toggly");
        registration.Should().NotBeNull();
        registration!.Tags.Should().Contain("feature-flags");
        registration.Tags.Should().Contain("toggly");
        registration.Tags.Should().Contain("critical");
    }

    #endregion

    #region AddTogglyHealthCheck With Configure Tests

    [Fact]
    public void AddTogglyHealthCheck_WithConfigureAction_ConfiguresOptions()
    {
        // Arrange
        var services = new ServiceCollection();
        RegisterRequiredServices(services);

        // Act
        services.AddHealthChecks()
            .AddTogglyHealthCheck(configure: options =>
            {
                options.RequiredFeatures = new[] { "feature1", "feature2" };
            });

        var serviceProvider = services.BuildServiceProvider();
        var healthCheckOptions = serviceProvider.GetService<IOptions<TogglyHealthCheckOptions>>();

        // Assert
        healthCheckOptions.Should().NotBeNull();
        healthCheckOptions!.Value.RequiredFeatures.Should().Contain("feature1");
        healthCheckOptions.Value.RequiredFeatures.Should().Contain("feature2");
    }

    [Fact]
    public void AddTogglyHealthCheck_WithoutConfigureAction_RegistersEmptyOptions()
    {
        // Arrange
        var services = new ServiceCollection();
        RegisterRequiredServices(services);

        // Act
        services.AddHealthChecks()
            .AddTogglyHealthCheck();

        var serviceProvider = services.BuildServiceProvider();
        var healthCheckOptions = serviceProvider.GetService<IOptions<TogglyHealthCheckOptions>>();

        // Assert
        healthCheckOptions.Should().NotBeNull();
    }

    [Fact]
    public void AddTogglyHealthCheck_WithNullConfigureAction_RegistersDefaultOptions()
    {
        // Arrange
        var services = new ServiceCollection();
        RegisterRequiredServices(services);

        // Act
        services.AddHealthChecks()
            .AddTogglyHealthCheck(configure: null);

        var serviceProvider = services.BuildServiceProvider();
        var healthCheckOptions = serviceProvider.GetService<IOptions<TogglyHealthCheckOptions>>();

        // Assert
        healthCheckOptions.Should().NotBeNull();
    }

    #endregion

    #region AddTogglyHealthCheck With Required Features Overload Tests

    [Fact]
    public void AddTogglyHealthCheck_WithRequiredFeatures_ConfiguresRequiredFeatures()
    {
        // Arrange
        var services = new ServiceCollection();
        RegisterRequiredServices(services);
        var requiredFeatures = new[] { "critical-feature", "mandatory-feature" };

        // Act
        services.AddHealthChecks()
            .AddTogglyHealthCheck(requiredFeatures);

        var serviceProvider = services.BuildServiceProvider();
        var healthCheckOptions = serviceProvider.GetService<IOptions<TogglyHealthCheckOptions>>();

        // Assert
        healthCheckOptions.Should().NotBeNull();
        healthCheckOptions!.Value.RequiredFeatures.Should().Contain("critical-feature");
        healthCheckOptions.Value.RequiredFeatures.Should().Contain("mandatory-feature");
    }

    [Fact]
    public void AddTogglyHealthCheck_WithRequiredFeaturesAndCustomName_BothConfigured()
    {
        // Arrange
        var services = new ServiceCollection();
        RegisterRequiredServices(services);
        var requiredFeatures = new[] { "my-feature" };

        // Act
        services.AddHealthChecks()
            .AddTogglyHealthCheck(requiredFeatures, name: "custom-name");

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<HealthCheckServiceOptions>>();
        var healthCheckOptions = serviceProvider.GetService<IOptions<TogglyHealthCheckOptions>>();

        // Assert
        options!.Value.Registrations.Should().Contain(r => r.Name == "custom-name");
        healthCheckOptions!.Value.RequiredFeatures.Should().Contain("my-feature");
    }

    [Fact]
    public void AddTogglyHealthCheck_WithRequiredFeaturesAndFailureStatus_BothConfigured()
    {
        // Arrange
        var services = new ServiceCollection();
        RegisterRequiredServices(services);
        var requiredFeatures = new[] { "required-feature" };

        // Act
        services.AddHealthChecks()
            .AddTogglyHealthCheck(requiredFeatures, failureStatus: HealthStatus.Unhealthy);

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<HealthCheckServiceOptions>>();
        var healthCheckOptions = serviceProvider.GetService<IOptions<TogglyHealthCheckOptions>>();

        // Assert
        var registration = options!.Value.Registrations.FirstOrDefault(r => r.Name == "toggly");
        registration!.FailureStatus.Should().Be(HealthStatus.Unhealthy);
        healthCheckOptions!.Value.RequiredFeatures.Should().Contain("required-feature");
    }

    [Fact]
    public void AddTogglyHealthCheck_WithRequiredFeaturesAndTags_BothConfigured()
    {
        // Arrange
        var services = new ServiceCollection();
        RegisterRequiredServices(services);
        var requiredFeatures = new[] { "tagged-feature" };
        var tags = new[] { "tag1", "tag2" };

        // Act
        services.AddHealthChecks()
            .AddTogglyHealthCheck(requiredFeatures, tags: tags);

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<HealthCheckServiceOptions>>();
        var healthCheckOptions = serviceProvider.GetService<IOptions<TogglyHealthCheckOptions>>();

        // Assert
        var registration = options!.Value.Registrations.FirstOrDefault(r => r.Name == "toggly");
        registration!.Tags.Should().Contain("tag1");
        registration.Tags.Should().Contain("tag2");
        healthCheckOptions!.Value.RequiredFeatures.Should().Contain("tagged-feature");
    }

    #endregion

    #region Chaining Tests

    [Fact]
    public void AddTogglyHealthCheck_ReturnsSameBuilder_ForChaining()
    {
        // Arrange
        var services = new ServiceCollection();
        RegisterRequiredServices(services);
        var builder = services.AddHealthChecks();

        // Act
        var result = builder.AddTogglyHealthCheck();

        // Assert
        result.Should().BeSameAs(builder);
    }

    [Fact]
    public void AddTogglyHealthCheck_WithRequiredFeatures_ReturnsSameBuilder_ForChaining()
    {
        // Arrange
        var services = new ServiceCollection();
        RegisterRequiredServices(services);
        var builder = services.AddHealthChecks();

        // Act
        var result = builder.AddTogglyHealthCheck(new[] { "feature" });

        // Assert
        result.Should().BeSameAs(builder);
    }

    [Fact]
    public void AddTogglyHealthCheck_CanBeChainedWithOtherHealthChecks()
    {
        // Arrange
        var services = new ServiceCollection();
        RegisterRequiredServices(services);

        // Act
        services.AddHealthChecks()
            .AddTogglyHealthCheck(name: "first-toggly")
            .AddTogglyHealthCheck(name: "second-toggly");

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<HealthCheckServiceOptions>>();

        // Assert
        options!.Value.Registrations.Should().Contain(r => r.Name == "first-toggly");
        options.Value.Registrations.Should().Contain(r => r.Name == "second-toggly");
    }

    #endregion

    #region Helper Methods

    private static void RegisterRequiredServices(IServiceCollection services)
    {
        // Register mock dependencies that TogglyHealthCheck needs
        // TogglyHealthCheck requires IFeatureDefinitionProvider that implements IFeatureProviderDebug
        var featureProviderMock = new Mock<IFeatureDefinitionProvider>();
        var featureProviderDebugMock = featureProviderMock.As<IFeatureProviderDebug>();
        featureProviderDebugMock.Setup(m => m.GetDebugInfo())
            .Returns(new FeatureProviderDebugInfo
            {
                Loaded = true,
                WebsocketClientRunning = true,
                LastDefinitionsCheck = DateTime.UtcNow
            });

        services.AddSingleton(featureProviderMock.Object);
        services.AddLogging();
    }

    #endregion
}
