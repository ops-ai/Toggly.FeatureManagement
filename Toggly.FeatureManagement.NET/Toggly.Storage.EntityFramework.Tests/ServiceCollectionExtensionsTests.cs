using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Storage.EntityFramework;
using Toggly.FeatureManagement.Storage.EntityFramework.Configuration;
using Xunit;

namespace Toggly.Storage.EntityFramework.Tests;

public sealed class ServiceCollectionExtensionsTests
{
    [Fact]
    public void AddTogglyEntityFrameworkCatalogStore_registers_the_catalog_factory_and_store()
    {
        var services = new ServiceCollection();

        var returnedServices = services.AddTogglyEntityFrameworkCatalogStore(options =>
            options.UseSqlite("Data Source=:memory:"));

        returnedServices.Should().BeSameAs(services);
        services.Single(descriptor => descriptor.ServiceType == typeof(ITogglyCatalogStore))
            .Should().Match<ServiceDescriptor>(descriptor =>
                descriptor.Lifetime == ServiceLifetime.Singleton &&
                descriptor.ImplementationType == typeof(EntityFrameworkCatalogStore));

        using var provider = services.BuildServiceProvider();
        provider.GetRequiredService<IDbContextFactory<TogglyCatalogDbContext>>().Should().NotBeNull();
    }

    [Fact]
    public void AddTogglyEntityFrameworkCatalogStore_rejects_missing_required_arguments()
    {
        var services = new ServiceCollection();

        var missingServices = () => ServiceCollectionExtensions.AddTogglyEntityFrameworkCatalogStore(
            null!, options => options.UseSqlite("Data Source=:memory:"));
        var missingConfiguration = () => services.AddTogglyEntityFrameworkCatalogStore(null!);

        missingServices.Should().Throw<ArgumentNullException>().Which.ParamName.Should().Be("services");
        missingConfiguration.Should().Throw<ArgumentNullException>().Which.ParamName.Should().Be("configureDatabase");
    }

    [Fact]
    public void AddTogglyEntityFrameworkSnapshotProvider_with_database_configuration_binds_configured_settings()
    {
        var services = new ServiceCollection();

        var returnedServices = services.AddTogglyEntityFrameworkSnapshotProvider(
            options => options.UseSqlite("Data Source=:memory:"),
            settings =>
            {
                settings.DocumentName = "feature-cache";
                settings.JwkDocumentName = "jwk-cache";
                settings.AutoCreateTable = false;
            });

        returnedServices.Should().BeSameAs(services);
        AssertSnapshotProviderRegistration(services);
        using var provider = services.BuildServiceProvider();
        var settings = provider.GetRequiredService<IOptions<TogglySnapshotSettings>>().Value;
        settings.DocumentName.Should().Be("feature-cache");
        settings.JwkDocumentName.Should().Be("jwk-cache");
        settings.AutoCreateTable.Should().BeFalse();

        using var scope = provider.CreateScope();
        scope.ServiceProvider.GetRequiredService<TogglyEntities>().Database.ProviderName.Should().Contain("Sqlite");
    }

    [Fact]
    public void AddTogglyEntityFrameworkSnapshotProvider_with_settings_instance_copies_its_values()
    {
        var services = new ServiceCollection();

        services.AddTogglyEntityFrameworkSnapshotProvider(
            options => options.UseSqlite("Data Source=:memory:"),
            new TogglySnapshotSettings
            {
                DocumentName = "feature-cache",
                JwkDocumentName = "jwk-cache",
                AutoCreateTable = false
            });

        AssertSnapshotProviderRegistration(services);
        using var provider = services.BuildServiceProvider();
        var settings = provider.GetRequiredService<IOptions<TogglySnapshotSettings>>().Value;
        settings.DocumentName.Should().Be("feature-cache");
        settings.JwkDocumentName.Should().Be("jwk-cache");
        settings.AutoCreateTable.Should().BeFalse();
    }

    [Fact]
    public void AddTogglyEntityFrameworkSnapshotProvider_with_existing_context_registration_keeps_that_context()
    {
        var services = new ServiceCollection();
        services.AddDbContext<TogglyEntities>(options => options.UseSqlite("Data Source=:memory:"));

        services.AddTogglyEntityFrameworkSnapshotProvider(settings =>
        {
            settings.DocumentName = "feature-cache";
            settings.AutoCreateTable = false;
        });

        AssertSnapshotProviderRegistration(services);
        using var provider = services.BuildServiceProvider();
        provider.GetRequiredService<IOptions<TogglySnapshotSettings>>().Value.DocumentName.Should().Be("feature-cache");

        using var scope = provider.CreateScope();
        scope.ServiceProvider.GetRequiredService<TogglyEntities>().Database.ProviderName.Should().Contain("Sqlite");
    }

    private static void AssertSnapshotProviderRegistration(IServiceCollection services)
    {
        services.Single(descriptor => descriptor.ServiceType == typeof(IFeatureSnapshotProvider))
            .Should().Match<ServiceDescriptor>(descriptor =>
                descriptor.Lifetime == ServiceLifetime.Singleton &&
                descriptor.ImplementationType == typeof(EntityFrameworkFeatureSnapshotProvider));
    }
}
