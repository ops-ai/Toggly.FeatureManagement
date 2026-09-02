using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Toggly.FeatureManagement.Configuration;
using Toggly.FeatureManagement.Web.Configuration;
using Xunit;

namespace Toggly.FeatureManagement.Web.Tests;

public class ServiceCollectionExtensionsTests
{
    #region AddTogglyHttpContext Tests

    [Fact]
    public void AddTogglyHttpContext_RegistersHttpContextAccessor()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        services.AddTogglyHttpContext();

        var serviceProvider = services.BuildServiceProvider();
        var httpContextAccessor = serviceProvider.GetService<IHttpContextAccessor>();

        // Assert
        httpContextAccessor.Should().NotBeNull();
    }

    [Fact]
    public void AddTogglyHttpContext_RegistersHttpFeatureContextProvider()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        services.AddTogglyHttpContext();

        var serviceProvider = services.BuildServiceProvider();
        var featureContextProvider = serviceProvider.GetService<IFeatureContextProvider>();

        // Assert
        featureContextProvider.Should().NotBeNull();
        featureContextProvider.Should().BeOfType<HttpFeatureContextProvider>();
    }

    [Fact]
    public void AddTogglyHttpContext_ReturnsSameServiceCollection()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        var result = services.AddTogglyHttpContext();

        // Assert
        result.Should().BeSameAs(services);
    }

    [Fact]
    public void AddTogglyHttpContext_CalledMultipleTimes_DoesNotDuplicateRegistrations()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        services.AddTogglyHttpContext();
        services.AddTogglyHttpContext();

        // Assert - should only have one registration of each
        var httpContextAccessorRegistrations = services.Where(s => s.ServiceType == typeof(IHttpContextAccessor)).ToList();
        var featureContextProviderRegistrations = services.Where(s => s.ServiceType == typeof(IFeatureContextProvider)).ToList();

        httpContextAccessorRegistrations.Should().HaveCount(1);
        featureContextProviderRegistrations.Should().HaveCount(1);
    }

    #endregion

    #region AddTogglyWeb with Action Tests

    [Fact]
    public void AddTogglyWeb_WithAction_ReturnsFeatureManagementBuilder()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        var result = services.AddTogglyWeb(options =>
        {
            options.AppKey = "test-key";
            options.Environment = "Test";
        });

        // Assert
        result.Should().NotBeNull();
        result.Should().BeAssignableTo<IFeatureManagementBuilder>();
    }

    [Fact]
    public void AddTogglyWeb_WithAction_RegistersFeatureManager()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddLogging();

        // Act
        services.AddTogglyWeb(options =>
        {
            options.AppKey = "test-key";
            options.Environment = "Test";
        });

        // Assert - verify registration exists
        var featureManagerRegistration = services.FirstOrDefault(s => s.ServiceType == typeof(IFeatureManager));
        featureManagerRegistration.Should().NotBeNull();
    }

    [Fact]
    public void AddTogglyWeb_WithAction_RegistersHttpContextAccessor()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddLogging();

        // Act
        services.AddTogglyWeb(options =>
        {
            options.AppKey = "test-key";
            options.Environment = "Test";
        });

        var serviceProvider = services.BuildServiceProvider();
        var httpContextAccessor = serviceProvider.GetService<IHttpContextAccessor>();

        // Assert
        httpContextAccessor.Should().NotBeNull();
    }

    [Fact]
    public void AddTogglyWeb_WithAction_RegistersFeatureContextProvider()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddLogging();

        // Act
        services.AddTogglyWeb(options =>
        {
            options.AppKey = "test-key";
            options.Environment = "Test";
        });

        var serviceProvider = services.BuildServiceProvider();
        var featureContextProvider = serviceProvider.GetService<IFeatureContextProvider>();

        // Assert
        featureContextProvider.Should().NotBeNull();
        featureContextProvider.Should().BeOfType<HttpFeatureContextProvider>();
    }

    [Fact]
    public void AddTogglyWeb_WithAction_ConfiguresTogglySettings()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddLogging();

        // Act
        services.AddTogglyWeb(options =>
        {
            options.AppKey = "my-app-key";
            options.Environment = "Staging";
        });

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<TogglySettings>>();

        // Assert
        options.Should().NotBeNull();
        options!.Value.AppKey.Should().Be("my-app-key");
        options.Value.Environment.Should().Be("Staging");
    }

    [Fact]
    public void AddTogglyWeb_WithAction_CanBeChainedWithOtherServices()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        services
            .AddLogging()
            .AddTogglyWeb(options =>
            {
                options.AppKey = "test-key";
            })
            .WithTogglyTargeting<TestTargetingContextAccessor>();

        // Assert - verify registrations exist
        var featureManagerRegistration = services.FirstOrDefault(s => s.ServiceType == typeof(IFeatureManager));
        var targetingContextAccessorRegistration = services.FirstOrDefault(s => s.ServiceType == typeof(ITargetingContextAccessor));

        featureManagerRegistration.Should().NotBeNull();
        targetingContextAccessorRegistration.Should().NotBeNull();
    }

    #endregion

    #region AddTogglyWeb with Settings Object Tests

    [Fact]
    public void AddTogglyWeb_WithSettingsObject_ReturnsFeatureManagementBuilder()
    {
        // Arrange
        var services = new ServiceCollection();
        var settings = new TogglySettings
        {
            AppKey = "test-key",
            Environment = "Test"
        };

        // Act
        var result = services.AddTogglyWeb(settings);

        // Assert
        result.Should().NotBeNull();
        result.Should().BeAssignableTo<IFeatureManagementBuilder>();
    }

    [Fact]
    public void AddTogglyWeb_WithSettingsObject_RegistersFeatureManager()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddLogging();
        var settings = new TogglySettings
        {
            AppKey = "test-key",
            Environment = "Test"
        };

        // Act
        services.AddTogglyWeb(settings);

        // Assert - verify registration exists
        var featureManagerRegistration = services.FirstOrDefault(s => s.ServiceType == typeof(IFeatureManager));
        featureManagerRegistration.Should().NotBeNull();
    }

    [Fact]
    public void AddTogglyWeb_WithSettingsObject_RegistersHttpContextAccessor()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddLogging();
        var settings = new TogglySettings
        {
            AppKey = "test-key",
            Environment = "Test"
        };

        // Act
        services.AddTogglyWeb(settings);

        var serviceProvider = services.BuildServiceProvider();
        var httpContextAccessor = serviceProvider.GetService<IHttpContextAccessor>();

        // Assert
        httpContextAccessor.Should().NotBeNull();
    }

    [Fact]
    public void AddTogglyWeb_WithSettingsObject_RegistersFeatureContextProvider()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddLogging();
        var settings = new TogglySettings
        {
            AppKey = "test-key",
            Environment = "Test"
        };

        // Act
        services.AddTogglyWeb(settings);

        var serviceProvider = services.BuildServiceProvider();
        var featureContextProvider = serviceProvider.GetService<IFeatureContextProvider>();

        // Assert
        featureContextProvider.Should().NotBeNull();
        featureContextProvider.Should().BeOfType<HttpFeatureContextProvider>();
    }

    [Fact]
    public void AddTogglyWeb_WithSettingsObject_ConfiguresTogglySettings()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddLogging();
        var settings = new TogglySettings
        {
            AppKey = "settings-app-key",
            Environment = "Production",
            UseSignedDefinitions = true,
            AllowedKeyIds = new HashSet<string> { "key1ES256" },
            UndefinedEnabledOnDevelopment = true,
            JwksCacheDuration = TimeSpan.FromHours(6),
            DefinitionsBaseUrl = "https://definitions.example.test/"
        };

        // Act
        services.AddTogglyWeb(settings);

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<TogglySettings>>();

        // Assert
        options.Should().NotBeNull();
        options!.Value.AppKey.Should().Be("settings-app-key");
        options.Value.Environment.Should().Be("Production");
        options.Value.UseSignedDefinitions.Should().BeTrue();
        options.Value.AllowedKeyIds.Should().Contain("key1ES256");
        options.Value.UndefinedEnabledOnDevelopment.Should().BeTrue();
        options.Value.JwksCacheDuration.Should().Be(TimeSpan.FromHours(6));
        options.Value.DefinitionsBaseUrl.Should().Be("https://definitions.example.test/");
    }

    [Fact]
    public void AddTogglyWeb_DefaultsToFailClosedMissingFeatureFilters()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddLogging();

        // Act
        services.AddTogglyWeb(options =>
        {
            options.AppKey = "app-key";
            options.Environment = "Production";
        });

        var serviceProvider = services.BuildServiceProvider();
        var featureOptions = serviceProvider.GetRequiredService<IOptions<FeatureManagementOptions>>();

        // Assert
        featureOptions.Value.IgnoreMissingFeatureFilters.Should().BeFalse();
    }

    [Fact]
    public void AddTogglyWeb_WithSettingsObject_CanBeChainedWithOtherServices()
    {
        // Arrange
        var services = new ServiceCollection();
        var settings = new TogglySettings
        {
            AppKey = "test-key"
        };

        // Act
        services
            .AddLogging()
            .AddTogglyWeb(settings)
            .WithTogglyTargeting<TestTargetingContextAccessor>();

        // Assert - verify registrations exist
        var featureManagerRegistration = services.FirstOrDefault(s => s.ServiceType == typeof(IFeatureManager));
        var targetingContextAccessorRegistration = services.FirstOrDefault(s => s.ServiceType == typeof(ITargetingContextAccessor));

        featureManagerRegistration.Should().NotBeNull();
        targetingContextAccessorRegistration.Should().NotBeNull();
    }

    #endregion

    #region Helper Classes

    private class TestTargetingContextAccessor : ITargetingContextAccessor
    {
        public ValueTask<TargetingContext?> GetContextAsync()
        {
            return new ValueTask<TargetingContext?>(new TargetingContext
            {
                UserId = "test-user"
            });
        }
    }

    #endregion
}
