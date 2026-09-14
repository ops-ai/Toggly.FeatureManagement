using FluentAssertions;
using Toggly.FeatureManagement.Catalog;
using Xunit;

namespace Toggly.FeatureManagement.Embedded.Tests;

public class EmbeddedCatalogCoordinatorTests
{
    [Fact]
    public async Task Absent_catalog_has_uninitialized_diagnostics()
    {
        using var coordinator = new EmbeddedCatalogCoordinator(new TestStore(null), new EmbeddedFeatureProvider(), new TogglyEmbeddedOptions { CatalogName = "Orders" });
        await coordinator.RefreshAsync(default);
        coordinator.Diagnostics.StorageState.Should().Be(EmbeddedStorageState.Uninitialized);
        coordinator.Diagnostics.ActiveRevision.Should().BeNull();
    }
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
                Features = { new CatalogFeature { Key = "NewCheckout", Name = "New checkout", Enabled = true, Rules = { new CatalogRule { Name = "AlwaysOn" } } } }
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
            Document = new CatalogDocument { Features = { new CatalogFeature { Key = "Enabled", Name = "Enabled", Enabled = true, Rules = { new CatalogRule { Name = "AlwaysOn" } } } } }
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

    [Fact]
    public async Task RefreshAsync_UnchangedRevision_DoesNotRepublishOrNotifyDefinitions()
    {
        var store = new TestStore(EnabledSnapshot("one", "Feature"));
        var state = new TogglyFeatureStateService();
        var notifications = 0;
        state.WhenDefinitionsChange(() => notifications++);
        var coordinator = new EmbeddedCatalogCoordinator(store, new EmbeddedFeatureProvider(), new TogglyEmbeddedOptions { CatalogName = "Orders" }, state);

        await coordinator.RefreshAsync(CancellationToken.None);
        await coordinator.RefreshAsync(CancellationToken.None);

        notifications.Should().Be(1);
        coordinator.Diagnostics.StorageState.Should().Be(EmbeddedStorageState.Available);
    }

    [Fact]
    public async Task RefreshAsync_DeletionOfEnabledFeature_EmitsDisabledState()
    {
        var store = new TestStore(EnabledSnapshot("one", "Feature"));
        var state = new TogglyFeatureStateService();
        var offTransitions = 0;
        state.WhenFeatureTurnsOff("Feature", () => offTransitions++);
        var coordinator = new EmbeddedCatalogCoordinator(store, new EmbeddedFeatureProvider(), new TogglyEmbeddedOptions { CatalogName = "Orders" }, state);

        await coordinator.RefreshAsync(CancellationToken.None);
        store.Current = new CatalogSnapshot { CatalogName = "Orders", Revision = "two", UpdatedAtUtc = DateTimeOffset.UtcNow, Document = new CatalogDocument() };
        await coordinator.RefreshAsync(CancellationToken.None);

        offTransitions.Should().Be(1);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Refresh_rejects_oversized_or_changed_content_even_when_revision_is_reused(bool oversized)
    {
        var store = new TestStore(EnabledSnapshot("one", "Feature"));
        var provider = new EmbeddedFeatureProvider();
        using var coordinator = new EmbeddedCatalogCoordinator(store, provider,
            new TogglyEmbeddedOptions { CatalogName = "Orders", MaxCatalogBytes = 500 });
        await coordinator.RefreshAsync(default);
        store.Current = EnabledSnapshot("one", "Feature");
        store.Current.Document.Features[0].Enabled = false;
        if (oversized) store.Current.Document.Features[0].Description = new string('x', 600);
        await coordinator.RefreshAsync(default);
        coordinator.Diagnostics.StorageState.Should().Be(EmbeddedStorageState.Stale);
        provider.TryGetFeatureModel("Feature", out var active).Should().BeTrue();
        active!.Filters.Should().ContainSingle(filter => filter.Name == "AlwaysOn");
    }

    private static CatalogSnapshot EnabledSnapshot(string revision, string key) => new()
    {
        CatalogName = "Orders", Revision = revision, UpdatedAtUtc = DateTimeOffset.UtcNow,
        Document = new CatalogDocument { Features = { new CatalogFeature { Key = key, Name = key, Enabled = true, Rules = { new CatalogRule { Name = "AlwaysOn" } } } } }
    };

    private sealed class TestStore : ITogglyCatalogStore
    {
        public TestStore(CatalogSnapshot? current) => Current = current;
        public CatalogSnapshot? Current { get; set; }
        public CatalogStoreCapabilities Capabilities => new() { SupportsMultipleWriters = true };
        public Task<CatalogSnapshot?> ReadAsync(string catalogName, CancellationToken cancellationToken = default) => Task.FromResult(Current);
        public Task<CatalogWriteResult> TryWriteAsync(string catalogName, CatalogDocument document, string? expectedRevision, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
