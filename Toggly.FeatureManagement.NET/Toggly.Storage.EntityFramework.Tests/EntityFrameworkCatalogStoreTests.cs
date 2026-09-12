using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Storage.EntityFramework;
using Toggly.FeatureManagement.Storage.EntityFramework.Configuration;
using Toggly.FeatureManagement.Data;
using Xunit;

namespace Toggly.Storage.EntityFramework.Tests;

public sealed class EntityFrameworkCatalogStoreTests : IAsyncLifetime
{
    private string _databasePath = null!;
    private string _connectionString = null!;
    private PooledDbContextFactory<TogglyCatalogDbContext> _factory = null!;
    private EntityFrameworkCatalogStore _store = null!;

    public async Task InitializeAsync()
    {
        _databasePath = Path.Combine(Path.GetTempPath(), "toggly-catalog-" + Guid.NewGuid().ToString("N") + ".db");
        _connectionString = "Data Source=" + _databasePath + ";Pooling=False";

        var options = new DbContextOptionsBuilder<TogglyCatalogDbContext>()
            .UseSqlite(_connectionString)
            .Options;
        _factory = new PooledDbContextFactory<TogglyCatalogDbContext>(options);

        await using var context = await _factory.CreateDbContextAsync();
        await context.Database.EnsureCreatedAsync();
        _store = new EntityFrameworkCatalogStore(_factory);
    }

    public async Task DisposeAsync()
    {
        await Task.Yield();
        if (File.Exists(_databasePath)) File.Delete(_databasePath);
    }

    [Fact]
    public async Task ReadAsync_returns_null_only_when_a_catalog_is_absent()
    {
        var snapshot = await _store.ReadAsync("absent");

        snapshot.Should().BeNull();
    }

    [Fact]
    public async Task TryWriteAsync_creates_and_reads_a_canonical_snapshot()
    {
        var write = await _store.TryWriteAsync("orders", Document("Orders"), expectedRevision: null);

        write.Status.Should().Be(CatalogWriteStatus.Written);
        write.Snapshot.Should().NotBeNull();
        write.Snapshot!.CatalogName.Should().Be("orders");
        write.Snapshot.Revision.Should().NotBeNullOrWhiteSpace();

        var read = await _store.ReadAsync("orders");

        read.Should().BeEquivalentTo(write.Snapshot);
        read!.Document.Features.Single().Key.Should().Be("Orders");
    }

    [Fact]
    public async Task TryWriteAsync_second_create_conflicts_without_overwriting_the_catalog()
    {
        var first = await _store.TryWriteAsync("orders", Document("Orders"), expectedRevision: null);

        var second = await _store.TryWriteAsync("orders", Document("Replacement"), expectedRevision: null);

        second.Status.Should().Be(CatalogWriteStatus.Conflict);
        second.Snapshot!.Revision.Should().Be(first.Snapshot!.Revision);
        (await _store.ReadAsync("orders"))!.Document.Features.Single().Key.Should().Be("Orders");
    }

    [Fact]
    public async Task TryWriteAsync_accepts_only_the_current_revision()
    {
        var created = await _store.TryWriteAsync("orders", Document("Orders"), expectedRevision: null);
        var updated = await _store.TryWriteAsync("orders", Document("Replacement"), created.Snapshot!.Revision);
        var stale = await _store.TryWriteAsync("orders", Document("Stale"), created.Snapshot.Revision);

        updated.Status.Should().Be(CatalogWriteStatus.Written);
        updated.Snapshot!.Revision.Should().NotBe(created.Snapshot.Revision);
        stale.Status.Should().Be(CatalogWriteStatus.Conflict);
        stale.Snapshot!.Revision.Should().Be(updated.Snapshot.Revision);
        (await _store.ReadAsync("orders"))!.Document.Features.Single().Key.Should().Be("Replacement");
    }

    [Fact]
    public async Task TryWriteAsync_failed_update_preserves_the_committed_catalog()
    {
        var created = await _store.TryWriteAsync("orders", Document("Orders"), expectedRevision: null);

        var failed = await _store.TryWriteAsync("orders", Document("Replacement"), Guid.NewGuid().ToString("D"));

        failed.Status.Should().Be(CatalogWriteStatus.Conflict);
        failed.Snapshot!.Revision.Should().Be(created.Snapshot!.Revision);
        (await _store.ReadAsync("orders"))!.Document.Features.Single().Key.Should().Be("Orders");
    }

    [Fact]
    public async Task TryWriteAsync_from_separate_service_providers_allows_only_one_competing_update()
    {
        var created = await _store.TryWriteAsync("orders", Document("Orders"), expectedRevision: null);
        using var firstProvider = CreateProvider();
        using var secondProvider = CreateProvider();
        var firstStore = firstProvider.GetRequiredService<ITogglyCatalogStore>();
        var secondStore = secondProvider.GetRequiredService<ITogglyCatalogStore>();

        var writes = await Task.WhenAll(
            firstStore.TryWriteAsync("orders", Document("First"), created.Snapshot!.Revision),
            secondStore.TryWriteAsync("orders", Document("Second"), created.Snapshot.Revision));

        writes.Count(result => result.Status == CatalogWriteStatus.Written).Should().Be(1);
        writes.Count(result => result.Status == CatalogWriteStatus.Conflict).Should().Be(1);
        (await _store.ReadAsync("orders"))!.Document.Features.Single().Key.Should().BeOneOf("First", "Second");
    }

    [Fact]
    public async Task ReadAsync_corrupt_payload_throws_instead_of_reporting_absence()
    {
        await using (var context = await _factory.CreateDbContextAsync())
        {
            context.TogglyCatalogs.Add(new CatalogEntity
            {
                Id = EntityFrameworkCatalogStore.GetCatalogId("orders"),
                CatalogName = "orders",
                Revision = Guid.NewGuid().ToString("D"),
                Payload = "{not-json}",
                UpdatedAtUtc = DateTimeOffset.UtcNow
            });
            await context.SaveChangesAsync();
        }

        var action = () => _store.ReadAsync("orders");

        await action.Should().ThrowAsync<CatalogFormatException>();
    }

    [Fact]
    public async Task Catalog_names_are_isolated_and_ids_are_sha256()
    {
        await _store.TryWriteAsync("orders", Document("Orders"), expectedRevision: null);
        await _store.TryWriteAsync("billing", Document("Billing"), expectedRevision: null);

        EntityFrameworkCatalogStore.GetCatalogId("orders").Should().Be("1c168adb00d208e42f93314529f1fa9c0427eb63233ceda95a5db52b7012a719");
        (await _store.ReadAsync("orders"))!.Document.Features.Single().Key.Should().Be("Orders");
        (await _store.ReadAsync("billing"))!.Document.Features.Single().Key.Should().Be("Billing");
    }

    [Fact]
    public async Task Catalog_round_trips_complete_metadata_rules_and_contexts()
    {
        var source = new CatalogDocument
        {
            Features = new List<CatalogFeature>
            {
                new()
                {
                    Key = "NewCheckout",
                    Name = "New checkout",
                    Description = "Enable the new checkout experience.",
                    Tags = new List<string> { "checkout", "priority" },
                    Enabled = true,
                    RequirementType = CatalogRequirementType.All,
                    ContextKind = "Order",
                    ContextRequirementType = CatalogRequirementType.Any,
                    Rules = new List<CatalogRule>
                    {
                        new() { Name = "Percentage", Parameters = new Dictionary<string, string> { ["Value"] = "25" } },
                        new()
                        {
                            Name = "ContextProperty",
                            Parameters = new Dictionary<string, string>
                            {
                                ["ContextKind"] = "Order",
                                ["Property"] = "Total",
                                ["Operator"] = "gte",
                                ["Value"] = "42",
                                ["ValueType"] = "number"
                            }
                        }
                    }
                }
            },
            Contexts = new List<CatalogContextSchema>
            {
                new()
                {
                    Kind = "Order",
                    KeyPropertyName = "Id",
                    Properties = new List<CatalogContextProperty>
                    {
                        new() { Name = "Id", Type = "string" },
                        new() { Name = "Total", Type = "number" }
                    }
                }
            }
        };

        await _store.TryWriteAsync("orders", source, expectedRevision: null);
        var roundTripped = await _store.ReadAsync("orders");

        roundTripped.Should().NotBeNull();
        roundTripped!.Document.Features.Single().Should().BeEquivalentTo(source.Features.Single());
        roundTripped.Document.Contexts.Single().Should().BeEquivalentTo(source.Contexts.Single());
    }

    [Fact]
    public async Task Snapshot_cache_operations_do_not_touch_catalog_data()
    {
        await _store.TryWriteAsync("orders", Document("Orders"), expectedRevision: null);
        var snapshotOptions = new DbContextOptionsBuilder<TogglyEntities>().UseSqlite(_connectionString).Options;
        await using var snapshotContext = new TogglyEntities(snapshotOptions);
        await snapshotContext.Database.ExecuteSqlRawAsync("""
            CREATE TABLE "TogglySnapshots" (
                "Id" TEXT NOT NULL PRIMARY KEY,
                "Data" TEXT NOT NULL,
                "Signature" TEXT NULL,
                "KeyId" TEXT NULL,
                "Timestamp" INTEGER NULL,
                "SignedDefsJson" TEXT NULL,
                "ETag" TEXT NULL,
                "UpdatedAt" TEXT NOT NULL)
            """);
        var snapshotProvider = new EntityFrameworkFeatureSnapshotProvider(snapshotContext, Options.Create(new TogglySnapshotSettings
        {
            DocumentName = "snapshot",
            AutoCreateTable = false
        }));

        await snapshotProvider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot
        {
            Features = new List<FeatureDefinitionModel> { new() { FeatureKey = "CloudSnapshot" } }
        });

        (await _store.ReadAsync("orders"))!.Document.Features.Single().Key.Should().Be("Orders");
        (await snapshotContext.TogglySnapshots.CountAsync()).Should().Be(1);
    }

    private ServiceProvider CreateProvider()
    {
        var services = new ServiceCollection();
        services.AddTogglyEntityFrameworkCatalogStore(options => options.UseSqlite(_connectionString));
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
