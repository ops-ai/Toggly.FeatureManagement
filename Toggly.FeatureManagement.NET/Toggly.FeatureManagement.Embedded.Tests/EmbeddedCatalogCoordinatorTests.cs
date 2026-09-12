using FluentAssertions;
using Toggly.FeatureManagement.Catalog;
using Xunit;

namespace Toggly.FeatureManagement.Embedded.Tests;

public class EmbeddedCatalogCoordinatorTests
{
    [Fact]
    public async Task RefreshAsync_PublishesCompleteSnapshot_AndRemovesDeletedDefinitions()
    {
        var store = new TestStore(new CatalogSnapshot
        {
            CatalogName = "Orders",
            Revision = "one",
            UpdatedAtUtc = DateTimeOffset.UtcNow,
            Document = new CatalogDocument
            {
                Features = { new CatalogFeature { Key = "NewCheckout", Name = "New checkout", Enabled = true } }
            }
        });
        var provider = new EmbeddedFeatureProvider();
        var coordinator = new EmbeddedCatalogCoordinator(store, provider, new TogglyEmbeddedOptions { CatalogName = "Orders" });

        await coordinator.RefreshAsync(CancellationToken.None);
        provider.TryGetFeatureModel("NewCheckout", out var current).Should().BeTrue();
        current!.Filters.Should().ContainSingle(filter => filter.Name == "AlwaysOn");

        store.Current = new CatalogSnapshot
        {
            CatalogName = "Orders",
            Revision = "two",
            UpdatedAtUtc = DateTimeOffset.UtcNow,
            Document = new CatalogDocument()
        };

        await coordinator.RefreshAsync(CancellationToken.None);
        provider.TryGetFeatureModel("NewCheckout", out _).Should().BeFalse();
        coordinator.Diagnostics.ActiveRevision.Should().Be("two");
    }

    [Fact]
    public async Task RefreshAsync_InvalidCandidate_KeepsLastKnownGoodSnapshot()
    {
        var store = new TestStore(new CatalogSnapshot
        {
            CatalogName = "Orders", Revision = "one", UpdatedAtUtc = DateTimeOffset.UtcNow,
            Document = new CatalogDocument { Features = { new CatalogFeature { Key = "Enabled", Name = "Enabled", Enabled = true } } }
        });
        var provider = new EmbeddedFeatureProvider();
        var coordinator = new EmbeddedCatalogCoordinator(store, provider, new TogglyEmbeddedOptions { CatalogName = "Orders" });
        await coordinator.RefreshAsync(CancellationToken.None);

        store.Current = new CatalogSnapshot
        {
            CatalogName = "Orders", Revision = "bad", UpdatedAtUtc = DateTimeOffset.UtcNow,
            Document = new CatalogDocument { Features = { new CatalogFeature { Key = "not valid key", Name = "Bad", Enabled = true } } }
        };

        await coordinator.RefreshAsync(CancellationToken.None);

        provider.TryGetFeatureModel("Enabled", out _).Should().BeTrue();
        coordinator.Diagnostics.ActiveRevision.Should().Be("one");
        coordinator.Diagnostics.StorageState.Should().Be(EmbeddedStorageState.Stale);
    }

    private sealed class TestStore : ITogglyCatalogStore
    {
        public TestStore(CatalogSnapshot? current) => Current = current;
        public CatalogSnapshot? Current { get; set; }
        public CatalogStoreCapabilities Capabilities => new() { SupportsMultipleWriters = true };
        public Task<CatalogSnapshot?> ReadAsync(string catalogName, CancellationToken cancellationToken = default) => Task.FromResult(Current);
        public Task<CatalogWriteResult> TryWriteAsync(string catalogName, CatalogDocument document, string? expectedRevision, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
