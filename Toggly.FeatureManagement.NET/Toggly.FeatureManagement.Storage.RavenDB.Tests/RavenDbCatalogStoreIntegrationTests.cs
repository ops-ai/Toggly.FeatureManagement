using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Raven.Client.Documents;
using Raven.TestDriver;
using Toggly.FeatureManagement.Data;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Storage.RavenDB.Configuration;
using Xunit;

namespace Toggly.FeatureManagement.Storage.RavenDB.Tests;

public sealed class RavenDbCatalogStoreIntegrationTests : RavenTestDriver
{
    static RavenDbCatalogStoreIntegrationTests()
    {
        // RavenDB.Client/TestDriver 7.x embedded server. Azure.Core 1.64 / Hosting.Abstractions 10
        // already reference the net10 shared framework in this test host, so the embedded server
        // must target a compatible net10 runtime (exact older TFMs cannot roll forward).
        var options = new TestServerOptions { FrameworkVersion = "10.0.0+" };
        var dotNetPath = Environment.GetEnvironmentVariable("TOGGLY_RAVEN_TEST_DOTNET_PATH");
        if (!string.IsNullOrWhiteSpace(dotNetPath))
        {
            options.DotNetPath = dotNetPath;
        }

        ConfigureServer(options);
    }

    [SkippableFact]
    public async Task Separate_service_providers_allow_only_one_competing_update()
    {
        using var documentStore = CreateDocumentStoreOrSkip();
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

    [SkippableFact]
    public async Task Persisted_missing_and_null_features_keep_their_document_ids()
    {
        using var documentStore = CreateDocumentStoreOrSkip();
        using (var session = documentStore.OpenAsyncSession())
        {
            await session.StoreAsync(new Dictionary<string, object?> { ["Signature"] = "missing" }, "FeatureSnapshots/Missing");
            await session.StoreAsync(new Dictionary<string, object?> { ["Features"] = null, ["Signature"] = "null" }, "FeatureSnapshots/Null");
            await session.SaveChangesAsync();
        }

        foreach (var id in new[] { "FeatureSnapshots/Missing", "FeatureSnapshots/Null" })
        {
            var services = new ServiceCollection();
            services.AddSingleton(documentStore);
            services.AddTogglyRavenDbSnapshotProvider(new TogglySnapshotSettings { DocumentName = id });
            using var provider = services.BuildServiceProvider();
            var snapshots = provider.GetRequiredService<IFeatureSnapshotProvider>();
            var loaded = await snapshots.GetFeaturesSnapshotAsync();
            loaded.Should().NotBeNull();
            loaded!.Features.Should().BeNull();
            await snapshots.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = null, Signature = "updated" });

            using var read = documentStore.OpenAsyncSession();
            var persisted = await read.LoadAsync<FeatureSnapshot>(id);
            persisted.Id.Should().Be(id);
            persisted.Features.Should().BeNull();
            persisted.Signature.Should().Be("updated");
        }
    }

    [SkippableFact]
    public async Task Unassigned_snapshot_ids_are_generated_for_empty_and_legacy_null_values()
    {
        using var documentStore = CreateDocumentStoreOrSkip();
        var empty = new FeatureSnapshot();
        var legacy = new FeatureSnapshot { Id = null! };
        using (var session = documentStore.OpenAsyncSession())
        {
            await session.StoreAsync(empty);
            await session.StoreAsync(legacy);
            await session.SaveChangesAsync();
        }

        empty.Id.Should().NotBeNullOrWhiteSpace();
        legacy.Id.Should().NotBeNullOrWhiteSpace().And.NotBe(empty.Id);
        using var read = documentStore.OpenAsyncSession();
        (await read.LoadAsync<FeatureSnapshot>(empty.Id)).Id.Should().Be(empty.Id);
        (await read.LoadAsync<FeatureSnapshot>(legacy.Id)).Id.Should().Be(legacy.Id);
    }

    [SkippableFact]
    public async Task Object_settings_persist_jwk_snapshots_at_the_configured_document_name()
    {
        using var documentStore = CreateDocumentStoreOrSkip();
        var services = new ServiceCollection();
        services.AddSingleton(documentStore);
        services.AddTogglyRavenDbSnapshotProvider(new TogglySnapshotSettings { JwkDocumentName = "JwkSnapshots/Custom" });
        using var provider = services.BuildServiceProvider();
        var snapshots = provider.GetRequiredService<IFeatureSnapshotProvider>();
        var keys = new JsonWebKeySet { Keys = new List<JsonWebKey> { new() { Kid = "custom-key" } } };

        await snapshots.SaveJwkSnapshot(keys, 1234567890);

        using var read = documentStore.OpenAsyncSession();
        var persisted = await read.LoadAsync<JwkSnapshot>("JwkSnapshots/Custom");
        persisted.Should().NotBeNull();
        persisted.Id.Should().Be("JwkSnapshots/Custom");
        Assert.IsType<List<JsonWebKey>>(persisted.Jwks.Keys).Single().Kid.Should().Be("custom-key");
        (await read.LoadAsync<JwkSnapshot>("JwkSnapshots/Toggly")).Should().BeNull();
        var loaded = await snapshots.GetJwkSnapshotAsync();
        Assert.IsType<List<JsonWebKey>>(Assert.IsType<JsonWebKeySet>(loaded.Jwks).Keys).Single().Kid.Should().Be("custom-key");
        loaded.Timestamp.Should().Be(1234567890);
    }

    private IDocumentStore CreateDocumentStoreOrSkip()
    {
        try
        {
            return GetDocumentStore();
        }
        catch (Exception ex) when (IsEmbeddedServerStartupFailure(ex))
        {
            Skip.If(true, $"RavenDB embedded server failed to start: {ex.Message}");
            throw; // unreachable; Skip.If throws SkipException
        }
    }

    private static bool IsEmbeddedServerStartupFailure(Exception ex)
    {
        for (var current = ex; current != null; current = current.InnerException)
        {
            var message = current.Message ?? string.Empty;
            if (message.Contains("Unable to start the RavenDB Server", StringComparison.OrdinalIgnoreCase)
                || message.Contains("ServerLoadFailure", StringComparison.OrdinalIgnoreCase)
                || message.Contains("cannot roll-forward", StringComparison.OrdinalIgnoreCase)
                || message.Contains("System.Storage", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
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
