using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Moq;
using Raven.Client.Documents;
using Toggly.FeatureManagement.Storage.RavenDB.Configuration;
using Xunit;

namespace Toggly.FeatureManagement.Storage.RavenDB.Tests;

public class ServiceCollectionExtensionsTests
{
    #region AddTogglyRavenDbSnapshotProvider with Action Tests

    [Fact]
    public void AddTogglyRavenDbSnapshotProvider_WithAction_RegistersSnapshotProvider()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDocumentStore>());

        // Act
        services.AddTogglyRavenDbSnapshotProvider(options =>
        {
            options.DocumentName = "TestDocument";
        });

        var serviceProvider = services.BuildServiceProvider();
        var snapshotProvider = serviceProvider.GetService<IFeatureSnapshotProvider>();

        // Assert
        snapshotProvider.Should().NotBeNull();
        snapshotProvider.Should().BeOfType<RavenDBFeatureSnapshotProvider>();
    }

    [Fact]
    public void AddTogglyRavenDbSnapshotProvider_WithAction_ConfiguresOptions()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDocumentStore>());

        // Act
        services.AddTogglyRavenDbSnapshotProvider(options =>
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
    public void AddTogglyRavenDbSnapshotProvider_WithAction_ReturnsSameServiceCollection()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        var result = services.AddTogglyRavenDbSnapshotProvider(options => { });

        // Assert
        result.Should().BeSameAs(services);
    }

    #endregion

    #region AddTogglyRavenDbSnapshotProvider with Settings Object Tests

    [Fact]
    public void AddTogglyRavenDbSnapshotProvider_WithSettingsObject_RegistersSnapshotProvider()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDocumentStore>());
        var settings = new TogglySnapshotSettings { DocumentName = "TestDocument" };

        // Act
        services.AddTogglyRavenDbSnapshotProvider(settings);

        var serviceProvider = services.BuildServiceProvider();
        var snapshotProvider = serviceProvider.GetService<IFeatureSnapshotProvider>();

        // Assert
        snapshotProvider.Should().NotBeNull();
        snapshotProvider.Should().BeOfType<RavenDBFeatureSnapshotProvider>();
    }

    [Fact]
    public void AddTogglyRavenDbSnapshotProvider_WithSettingsObject_ConfiguresDocumentName()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDocumentStore>());
        var settings = new TogglySnapshotSettings { DocumentName = "MyDocument" };

        // Act
        services.AddTogglyRavenDbSnapshotProvider(settings);

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<TogglySnapshotSettings>>();

        // Assert
        options.Should().NotBeNull();
        options!.Value.DocumentName.Should().Be("MyDocument");
    }

    [Fact]
    public void AddTogglyRavenDbSnapshotProvider_WithEmptyDocumentName_DoesNotSetDocumentName()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDocumentStore>());
        var settings = new TogglySnapshotSettings { DocumentName = "" };

        // Act
        services.AddTogglyRavenDbSnapshotProvider(settings);

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<TogglySnapshotSettings>>();

        // Assert
        options.Should().NotBeNull();
        options!.Value.DocumentName.Should().BeNullOrEmpty();
    }

    [Fact]
    public void AddTogglyRavenDbSnapshotProvider_WithSettingsObject_ReturnsSameServiceCollection()
    {
        // Arrange
        var services = new ServiceCollection();
        var settings = new TogglySnapshotSettings();

        // Act
        var result = services.AddTogglyRavenDbSnapshotProvider(settings);

        // Assert
        result.Should().BeSameAs(services);
    }

    #endregion

    #region AddTogglyRavenDbSnapshotProvider with No Parameters Tests

    [Fact]
    public void AddTogglyRavenDbSnapshotProvider_WithNoParameters_RegistersSnapshotProvider()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDocumentStore>());

        // Act
        services.AddTogglyRavenDbSnapshotProvider();

        var serviceProvider = services.BuildServiceProvider();
        var snapshotProvider = serviceProvider.GetService<IFeatureSnapshotProvider>();

        // Assert
        snapshotProvider.Should().NotBeNull();
        snapshotProvider.Should().BeOfType<RavenDBFeatureSnapshotProvider>();
    }

    [Fact]
    public void AddTogglyRavenDbSnapshotProvider_WithNoParameters_RegistersDefaultOptions()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDocumentStore>());

        // Act
        services.AddTogglyRavenDbSnapshotProvider();

        var serviceProvider = services.BuildServiceProvider();
        var options = serviceProvider.GetService<IOptions<TogglySnapshotSettings>>();

        // Assert
        options.Should().NotBeNull();
    }

    [Fact]
    public void AddTogglyRavenDbSnapshotProvider_WithNoParameters_ReturnsSameServiceCollection()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        var result = services.AddTogglyRavenDbSnapshotProvider();

        // Assert
        result.Should().BeSameAs(services);
    }

    #endregion

    #region Chaining Tests

    [Fact]
    public void AddTogglyRavenDbSnapshotProvider_CanBeChainedWithOtherServices()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IDocumentStore>());

        // Act
        services
            .AddLogging()
            .AddTogglyRavenDbSnapshotProvider(options =>
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
