using FluentAssertions;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Storage.EntityFramework;
using Xunit;

namespace Toggly.Storage.EntityFramework.Tests;

public sealed class EntityFrameworkCatalogStoreTests : IAsyncLifetime
{
    private SqliteConnection _connection = null!;
    private IDbContextFactory<TogglyCatalogDbContext> _factory = null!;
    private EntityFrameworkCatalogStore _store = null!;

    public async Task InitializeAsync()
    {
        _connection = new SqliteConnection("Data Source=:memory:");
        await _connection.OpenAsync();

        var options = new DbContextOptionsBuilder<TogglyCatalogDbContext>()
            .UseSqlite(_connection)
            .Options;
        _factory = new PooledDbContextFactory<TogglyCatalogDbContext>(options);

        await using var context = await _factory.CreateDbContextAsync();
        await context.Database.EnsureCreatedAsync();
        _store = new EntityFrameworkCatalogStore(_factory);
    }

    public async Task DisposeAsync()
    {
        await _connection.DisposeAsync();
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
    public async Task TryWriteAsync_from_separate_factories_allows_only_one_competing_update()
    {
        var created = await _store.TryWriteAsync("orders", Document("Orders"), expectedRevision: null);
        var secondStore = new EntityFrameworkCatalogStore(_factory);

        var writes = await Task.WhenAll(
            _store.TryWriteAsync("orders", Document("First"), created.Snapshot!.Revision),
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

    private static CatalogDocument Document(string key) => new()
    {
        Features = new List<CatalogFeature>
        {
            new() { Key = key, Name = key, Description = string.Empty, Enabled = false }
        }
    };
}
