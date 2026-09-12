using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Raven.Client.Documents;
using Raven.TestDriver;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Storage.RavenDB.Configuration;
using Xunit;

namespace Toggly.FeatureManagement.Storage.RavenDB.Tests;

public sealed class RavenDbCatalogStoreIntegrationTests : RavenTestDriver
{
    static RavenDbCatalogStoreIntegrationTests()
    {
        var options = new TestServerOptions { FrameworkVersion = "7.0.14+" };
        var dotNetPath = Environment.GetEnvironmentVariable("TOGGLY_RAVEN_TEST_DOTNET_PATH");
        if (!string.IsNullOrWhiteSpace(dotNetPath))
        {
            options.DotNetPath = dotNetPath;
        }

        ConfigureServer(options);
    }

    [Fact]
    public async Task Separate_service_providers_allow_only_one_competing_update()
    {
        using var documentStore = GetDocumentStore();
        using var initialProvider = CreateProvider(documentStore);
        var initialStore = initialProvider.GetRequiredService<ITogglyCatalogStore>();
        var created = await initialStore.TryWriteAsync("orders", Document("Orders"), expectedRevision: null);

        using var firstProvider = CreateProvider(documentStore);
        using var secondProvider = CreateProvider(documentStore);
        var firstStore = firstProvider.GetRequiredService<ITogglyCatalogStore>();
        var secondStore = secondProvider.GetRequiredService<ITogglyCatalogStore>();

        var results = await Task.WhenAll(
            firstStore.TryWriteAsync("orders", Document("First"), created.Snapshot!.Revision),
            secondStore.TryWriteAsync("orders", Document("Second"), created.Snapshot.Revision));

        results.Count(result => result.Status == CatalogWriteStatus.Written).Should().Be(1);
        results.Count(result => result.Status == CatalogWriteStatus.Conflict).Should().Be(1);
        (await initialStore.ReadAsync("orders"))!.Document.Features.Single().Key.Should().BeOneOf("First", "Second");
    }

    private static ServiceProvider CreateProvider(IDocumentStore documentStore)
    {
        var services = new ServiceCollection();
        services.AddSingleton(documentStore);
        services.AddTogglyRavenDbCatalogStore();
        return services.BuildServiceProvider();
    }

    private static CatalogDocument Document(string key) => new()
    {
        Features = new List<CatalogFeature>
        {
            new() { Key = key, Name = key, Description = string.Empty, Enabled = false }
        }
    };
}
