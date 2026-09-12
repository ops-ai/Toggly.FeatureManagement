using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Toggly.FeatureManagement.Configuration;
using Toggly.FeatureManagement.Context;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Storage.EntityFramework.Configuration;
using Toggly.FeatureManagement.Storage.RavenDB.Configuration;
using Raven.Client.Documents;
using Xunit;

namespace Toggly.FeatureManagement.Embedded.Tests;

public class RegistrationTests
{
    [Fact]
    public void AddTogglyEmbedded_RejectsCloudRuntimeRegistration()
    {
        var services = new ServiceCollection();
        services.AddToggly();

        var action = () => services.AddTogglyEmbedded();

        action.Should().Throw<InvalidOperationException>().WithMessage("*cloud*embedded*");
    }

    [Fact]
    public void AddToggly_RejectsEmbeddedRuntimeRegistration()
    {
        var services = new ServiceCollection();
        services.AddTogglyEmbedded();

        var action = () => services.AddToggly();

        action.Should().Throw<InvalidOperationException>().WithMessage("*embedded*cloud*");
    }

    [Fact]
    public void AddTogglyEmbedded_IsIdempotent_AndDoesNotRegisterCloudClients()
    {
        var services = CreateServices();

        services.AddTogglyEmbedded();
        services.AddTogglyEmbedded();

        services.Count(descriptor => descriptor.ServiceType == typeof(IHostedService) && descriptor.ImplementationType == typeof(EmbeddedCatalogRefreshService)).Should().Be(1);
        services.Should().NotContain(descriptor => descriptor.ServiceType == typeof(IHttpClientFactory));
        services.Should().NotContain(descriptor => descriptor.ImplementationType == typeof(TogglyFeatureProvider));
    }

    [Fact]
    public void EmbeddedContextSchemaProvider_ProjectsRegisteredHostSchemas()
    {
        var services = CreateServices();
        services.AddTogglyEntityContext<Order>("Order", order => order.Id, builder => builder.Property("Total", "number"));
        services.AddTogglyEmbedded(options => options.CatalogName = "Orders");
        using var provider = services.BuildServiceProvider();

        var schemas = provider.GetRequiredService<EmbeddedContextSchemaProvider>().GetRegisteredSchemas();

        schemas.Should().ContainSingle();
        schemas[0].Kind.Should().Be("Order");
        schemas[0].KeyPropertyName.Should().Be("Id");
        schemas[0].Properties.Should().ContainSingle(property => property.Name == "Total" && property.Type == "number");
    }

    [Fact]
    public void EmbeddedCoordinator_RequiresExactlyOneCatalogStore()
    {
        var services = CreateServices();
        services.AddTogglyEmbedded(options => options.CatalogName = "Orders");
        using var provider = services.BuildServiceProvider();

        var action = () => provider.GetRequiredService<EmbeddedCatalogCoordinator>();

        action.Should().Throw<InvalidOperationException>().WithMessage("*exactly one ITogglyCatalogStore; found 0*");
    }

    [Fact]
    public void EmbeddedCoordinator_Rejects_distinct_entity_framework_and_ravendb_catalog_stores()
    {
        var services = CreateServices();
        services.AddSingleton<IDocumentStore>(new DocumentStore());
        services.AddTogglyEntityFrameworkCatalogStore(_ => { });
        services.AddTogglyEntityFrameworkCatalogStore(_ => { });
        services.AddTogglyRavenDbCatalogStore();
        services.AddTogglyRavenDbCatalogStore();
        services.AddTogglyEmbedded(options => options.CatalogName = "Orders");
        using var provider = services.BuildServiceProvider();

        var action = () => provider.GetRequiredService<EmbeddedCatalogCoordinator>();

        action.Should().Throw<InvalidOperationException>().WithMessage("*exactly one ITogglyCatalogStore; found 2*");
    }

    [Fact]
    public async Task EmbeddedRefreshService_LoadsTheInitialCatalog()
    {
        var services = CreateServices();
        var store = new RecordingStore(new CatalogSnapshot
        {
            CatalogName = "Orders", Revision = "one", UpdatedAtUtc = DateTimeOffset.UtcNow,
            Document = new CatalogDocument { Features = { new CatalogFeature { Key = "Checkout", Name = "Checkout", Enabled = true } } }
        });
        services.AddSingleton<ITogglyCatalogStore>(store);
        services.AddTogglyEmbedded(options => options.CatalogName = "Orders");
        await using var provider = services.BuildServiceProvider();
        var refreshService = provider.GetServices<IHostedService>().OfType<EmbeddedCatalogRefreshService>().Single();

        await refreshService.StartAsync(CancellationToken.None);
        await store.ReadStarted.Task.WaitAsync(TimeSpan.FromSeconds(2));

        provider.GetRequiredService<EmbeddedFeatureProvider>().TryGetFeatureModel("Checkout", out var feature).Should().BeTrue();
        feature!.Filters.Should().ContainSingle(filter => filter.Name == "AlwaysOn");
        await refreshService.StopAsync(CancellationToken.None);
    }

    private static ServiceCollection CreateServices()
    {
        var services = new ServiceCollection();
        services.AddSingleton<IHostEnvironment>(new TestHostEnvironment());
        return services;
    }

    private sealed class TestHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Production;
        public string ApplicationName { get; set; } = "EmbeddedTests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }

    private sealed class Order { public string Id { get; set; } = "1"; public decimal Total { get; set; } }

    private sealed class RecordingStore : ITogglyCatalogStore
    {
        private readonly CatalogSnapshot _snapshot;
        public RecordingStore(CatalogSnapshot snapshot) => _snapshot = snapshot;
        public TaskCompletionSource ReadStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public CatalogStoreCapabilities Capabilities => new() { SupportsMultipleWriters = true };
        public Task<CatalogSnapshot?> ReadAsync(string catalogName, CancellationToken cancellationToken = default)
        {
            ReadStarted.TrySetResult();
            return Task.FromResult<CatalogSnapshot?>(_snapshot);
        }
        public Task<CatalogWriteResult> TryWriteAsync(string catalogName, CatalogDocument document, string? expectedRevision, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
