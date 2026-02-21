using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using Toggly.FeatureManagement.Configuration;
using Toggly.FeatureManagement.Tests.TestHelpers;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class DependencyInjectionTests
{
    #region AddToggly Overloads Tests

    [Fact]
    public void AddToggly_WithActionOverload_RegistersCoreServices()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton<IHostEnvironment>(new TestHostEnvironment());
        services.AddSingleton<IHostApplicationLifetime>(new TestHostApplicationLifetime());

        // Act
        services.AddToggly(options =>
        {
            options.AppKey = "test-key";
            options.Environment = "Test";
        });
        // AddTogglyFeatureManagement is required because TogglyMetricsService depends on IFeatureManager
        services.AddTogglyFeatureManagement();

        var provider = services.BuildServiceProvider();

        // Assert
        provider.GetService<IFeatureStateService>().Should().NotBeNull();
        provider.GetService<IFeatureDefinitionProvider>().Should().NotBeNull();
        provider.GetService<IMetricsService>().Should().NotBeNull();
    }

    [Fact]
    public void AddToggly_WithSettingsObject_ConfiguresSettingsFromObject()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton<IHostEnvironment>(new TestHostEnvironment());
        services.AddSingleton<IHostApplicationLifetime>(new TestHostApplicationLifetime());

        var settings = new TogglySettings
        {
            AppKey = "my-app-key",
            Environment = "Production"
        };

        // Act
        services.AddToggly(settings);
        var provider = services.BuildServiceProvider();

        // Assert
        var options = provider.GetRequiredService<IOptions<TogglySettings>>();
        options.Value.AppKey.Should().Be("my-app-key");
    }

    [Fact]
    public void AddToggly_ParameterlessOverload_WorksWithPreConfiguredOptions()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton<IHostEnvironment>(new TestHostEnvironment());
        services.AddSingleton<IHostApplicationLifetime>(new TestHostApplicationLifetime());
        services.Configure<TogglySettings>(options =>
        {
            options.AppKey = "pre-configured-key";
        });

        // Act
        services.AddToggly();
        var provider = services.BuildServiceProvider();

        // Assert
        var options = provider.GetRequiredService<IOptions<TogglySettings>>();
        options.Value.AppKey.Should().Be("pre-configured-key");
    }

    #endregion

    #region AddTogglyFeatureManagement Tests

    [Fact]
    public void AddTogglyFeatureManagement_RegistersFeatureFilters()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton<IHostEnvironment>(new TestHostEnvironment());
        services.AddSingleton<IHostApplicationLifetime>(new TestHostApplicationLifetime());
        services.AddToggly();

        // Act
        services.AddTogglyFeatureManagement();
        var provider = services.BuildServiceProvider();

        // Assert
        var featureManager = provider.GetService<IFeatureManager>();
        featureManager.Should().NotBeNull();
    }

    [Fact]
    public void AddTogglyFeatureManagement_DecoratesFeatureManagerWithTogglyFeatureManager()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton<IHostEnvironment>(new TestHostEnvironment());
        services.AddSingleton<IHostApplicationLifetime>(new TestHostApplicationLifetime());
        services.AddToggly();

        // Act
        services.AddTogglyFeatureManagement();
        var provider = services.BuildServiceProvider();

        // Assert
        var featureManager = provider.GetService<IFeatureManager>();
        featureManager.Should().BeOfType<TogglyFeatureManager>();
    }

    #endregion

    #region Service Resolution Tests

    [Fact]
    public void ResolvedFeatureDefinitionProvider_IsTogglyFeatureProvider()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton<IHostEnvironment>(new TestHostEnvironment());
        services.AddSingleton<IHostApplicationLifetime>(new TestHostApplicationLifetime());
        services.AddToggly();
        var provider = services.BuildServiceProvider();

        // Act
        var featureProvider = provider.GetService<IFeatureDefinitionProvider>();

        // Assert
        featureProvider.Should().BeOfType<TogglyFeatureProvider>();
    }

    [Fact]
    public void ResolvedFeatureStateService_IsSameSingleton_AsFeatureStateInternalService()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton<IHostEnvironment>(new TestHostEnvironment());
        services.AddSingleton<IHostApplicationLifetime>(new TestHostApplicationLifetime());
        services.AddToggly();
        var provider = services.BuildServiceProvider();

        // Act
        var stateService = provider.GetService<IFeatureStateService>();
        var internalService = provider.GetService<IFeatureStateInternalService>();

        // Assert
        stateService.Should().BeSameAs(internalService);
    }

    [Fact]
    public void ResolvedMetricsService_IsSameSingleton_AsMetricsDebug()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton<IHostEnvironment>(new TestHostEnvironment());
        services.AddSingleton<IHostApplicationLifetime>(new TestHostApplicationLifetime());
        services.AddToggly();
        // AddTogglyFeatureManagement is required because TogglyMetricsService depends on IFeatureManager
        services.AddTogglyFeatureManagement();
        var provider = services.BuildServiceProvider();

        // Act
        var metricsService = provider.GetService<IMetricsService>();
        var metricsDebug = provider.GetService<IMetricsDebug>();

        // Assert
        metricsService.Should().BeSameAs(metricsDebug);
    }

    [Fact]
    public void HttpClient_Toggly_IsRegistered()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton<IHostEnvironment>(new TestHostEnvironment());
        services.AddSingleton<IHostApplicationLifetime>(new TestHostApplicationLifetime());
        services.AddToggly(options =>
        {
            options.DefinitionsBaseUrl = "https://test.definitions.io/";
        });
        var provider = services.BuildServiceProvider();

        // Act
        var httpClientFactory = provider.GetService<IHttpClientFactory>();

        // Assert
        httpClientFactory.Should().NotBeNull();
        var client = httpClientFactory!.CreateClient("toggly");
        client.Should().NotBeNull();
        client.BaseAddress.Should().Be(new Uri("https://test.definitions.io/"));
    }

    #endregion

    #region Settings Configuration Tests

    [Fact]
    public void TogglySettings_BaseUrl_DefaultsCorrectly_WhenNotProvided()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton<IHostEnvironment>(new TestHostEnvironment());
        services.AddSingleton<IHostApplicationLifetime>(new TestHostApplicationLifetime());
        services.AddToggly(new TogglySettings { AppKey = "test" });
        var provider = services.BuildServiceProvider();

        // Act
        var options = provider.GetRequiredService<IOptions<TogglySettings>>();

        // Assert
        options.Value.BaseUrl.Should().Be("https://app.toggly.io/");
    }

    [Fact]
    public void TogglySettings_CustomValues_ArePreserved()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton<IHostEnvironment>(new TestHostEnvironment());
        services.AddSingleton<IHostApplicationLifetime>(new TestHostApplicationLifetime());
        services.AddToggly(new TogglySettings
        {
            AppKey = "custom-key",
            Environment = "Staging",
            BaseUrl = "https://custom.toggly.io",
            DefinitionsBaseUrl = "https://custom.definitions.io",
            AppVersion = "2.0.0",
            InstanceName = "custom-instance"
        });
        var provider = services.BuildServiceProvider();

        // Act
        var options = provider.GetRequiredService<IOptions<TogglySettings>>();

        // Assert
        options.Value.AppKey.Should().Be("custom-key");
        options.Value.Environment.Should().Be("Staging");
        options.Value.BaseUrl.Should().Be("https://custom.toggly.io");
        options.Value.DefinitionsBaseUrl.Should().Be("https://custom.definitions.io");
        options.Value.AppVersion.Should().Be("2.0.0");
        options.Value.InstanceName.Should().Be("custom-instance");
    }

    #endregion
}

// Test helpers for DI tests
file class TestHostEnvironment : IHostEnvironment
{
    public string EnvironmentName { get; set; } = "Test";
    public string ApplicationName { get; set; } = "TestApp";
    public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
    public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
}

file class TestHostApplicationLifetime : IHostApplicationLifetime
{
    private readonly CancellationTokenSource _stoppingCts = new();
    private readonly CancellationTokenSource _stoppedCts = new();

    public CancellationToken ApplicationStarted => CancellationToken.None;
    public CancellationToken ApplicationStopping => _stoppingCts.Token;
    public CancellationToken ApplicationStopped => _stoppedCts.Token;

    public void StopApplication()
    {
        _stoppingCts.Cancel();
    }
}
