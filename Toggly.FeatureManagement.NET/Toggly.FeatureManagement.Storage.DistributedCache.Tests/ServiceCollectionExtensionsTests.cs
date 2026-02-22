using FluentAssertions;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Moq;
using Toggly.FeatureManagement.Storage.DistributedCache.Configuration;
using Xunit;

namespace Toggly.FeatureManagement.Storage.DistributedCache.Tests;

public class ServiceCollectionExtensionsTests
{
    #region AddTogglyDistributedCacheSnapshotProvider with Action Tests

    [Fact]
    public void AddTogglyDistributedCacheSnapshotProvider_WithAction_RegistersSnapshotProvider()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDistributedCache>());

        // Act
        services.AddTogglyDistributedCacheSnapshotProvider(options =>
        {
            options.DocumentName = "TestDocument";
        });

        var serviceProvider = services.BuildServiceProvider();
        var snapshotProvider = serviceProvider.GetService<IFeatureSnapshotProvider>();

        // Assert
        snapshotProvider.Should().NotBeNull();
        snapshotProvider.Should().BeOfType<DistributedCacheFeatureSnapshotProvider>();
    }

    [Fact]
    public void AddTogglyDistributedCacheSnapshotProvider_WithAction_ConfiguresOptions()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDistributedCache>());

        // Act
        services.AddTogglyDistributedCacheSnapshotProvider(options =>
        {
            options.DocumentName = "CustomDocument";
            options.JwkDocumentName = "CustomJwkDocument";
        });

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<TogglySnapshotSettings>>();

        // Assert
        options.Should().NotBeNull();
        options!.Value.DocumentName.Should().Be("CustomDocument");
        options.Value.JwkDocumentName.Should().Be("CustomJwkDocument");
    }

    [Fact]
    public void AddTogglyDistributedCacheSnapshotProvider_WithAction_ReturnsSameServiceCollection()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        var result = services.AddTogglyDistributedCacheSnapshotProvider(options => { });

        // Assert
        result.Should().BeSameAs(services);
    }

    #endregion

    #region AddTogglyDistributedCacheSnapshotProvider with Settings Object Tests

    [Fact]
    public void AddTogglyDistributedCacheSnapshotProvider_WithSettingsObject_RegistersSnapshotProvider()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDistributedCache>());
        var settings = new TogglySnapshotSettings { DocumentName = "TestDocument" };

        // Act
        services.AddTogglyDistributedCacheSnapshotProvider(settings);

        var serviceProvider = services.BuildServiceProvider();
        var snapshotProvider = serviceProvider.GetService<IFeatureSnapshotProvider>();

        // Assert
        snapshotProvider.Should().NotBeNull();
        snapshotProvider.Should().BeOfType<DistributedCacheFeatureSnapshotProvider>();
    }

    [Fact]
    public void AddTogglyDistributedCacheSnapshotProvider_WithSettingsObject_ConfiguresDocumentName()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDistributedCache>());
        var settings = new TogglySnapshotSettings { DocumentName = "MyDocument" };

        // Act
        services.AddTogglyDistributedCacheSnapshotProvider(settings);

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<TogglySnapshotSettings>>();

        // Assert
        options.Should().NotBeNull();
        options!.Value.DocumentName.Should().Be("MyDocument");
    }

    [Fact]
    public void AddTogglyDistributedCacheSnapshotProvider_WithEmptyDocumentName_DoesNotSetDocumentName()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDistributedCache>());
        var settings = new TogglySnapshotSettings { DocumentName = "" };

        // Act
        services.AddTogglyDistributedCacheSnapshotProvider(settings);

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<TogglySnapshotSettings>>();

        // Assert
        options.Should().NotBeNull();
        options!.Value.DocumentName.Should().BeNullOrEmpty();
    }

    [Fact]
    public void AddTogglyDistributedCacheSnapshotProvider_WithSettingsObject_ReturnsSameServiceCollection()
    {
        // Arrange
        var services = new ServiceCollection();
        var settings = new TogglySnapshotSettings();

        // Act
        var result = services.AddTogglyDistributedCacheSnapshotProvider(settings);

        // Assert
        result.Should().BeSameAs(services);
    }

    #endregion

    #region AddTogglyDistributedCacheSnapshotProvider with No Parameters Tests

    [Fact]
    public void AddTogglyDistributedCacheSnapshotProvider_WithNoParameters_RegistersSnapshotProvider()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDistributedCache>());

        // Act
        services.AddTogglyDistributedCacheSnapshotProvider();

        var serviceProvider = services.BuildServiceProvider();
        var snapshotProvider = serviceProvider.GetService<IFeatureSnapshotProvider>();

        // Assert
        snapshotProvider.Should().NotBeNull();
        snapshotProvider.Should().BeOfType<DistributedCacheFeatureSnapshotProvider>();
    }

    [Fact]
    public void AddTogglyDistributedCacheSnapshotProvider_WithNoParameters_RegistersDefaultOptions()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDistributedCache>());

        // Act
        services.AddTogglyDistributedCacheSnapshotProvider();

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<TogglySnapshotSettings>>();

        // Assert
        options.Should().NotBeNull();
    }

    [Fact]
    public void AddTogglyDistributedCacheSnapshotProvider_WithNoParameters_ReturnsSameServiceCollection()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        var result = services.AddTogglyDistributedCacheSnapshotProvider();

        // Assert
        result.Should().BeSameAs(services);
    }

    #endregion

    #region Chaining Tests

    [Fact]
    public void AddTogglyDistributedCacheSnapshotProvider_CanBeChainedWithOtherServices()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDistributedCache>());

        // Act
        services
            .AddLogging()
            .AddTogglyDistributedCacheSnapshotProvider(options =>
            {
                options.DocumentName = "ChainedDocument";
            })
            .AddOptions();

        var serviceProvider = services.BuildServiceProvider();
        var snapshotProvider = serviceProvider.GetService<IFeatureSnapshotProvider>();

        // Assert
        snapshotProvider.Should().NotBeNull();
    }

    #endregion
}
