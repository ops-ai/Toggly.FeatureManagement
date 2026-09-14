using Microsoft.Extensions.Options;
using Toggly.FeatureManagement.Catalog;
using Xunit;

namespace Toggly.FeatureManagement.Embedded.Tests;

public sealed class EmbeddedCatalogEditorTests
{
    [Fact]
    public async Task Unavailable_runtime_blocks_writes_until_a_successful_refresh()
    {
        var store = new Store { ReadFailure = true };
        var (editor, coordinator, _) = Create(store);
        await coordinator.RefreshAsync(default);
        store.ReadFailure = false;
        await Assert.ThrowsAsync<InvalidOperationException>(() => editor.TryWriteAsync(new CatalogDocument(), "one"));
        Assert.Equal(0, store.Writes);
        await coordinator.RefreshAsync(default);
        Assert.Equal(CatalogWriteStatus.Written, (await editor.TryWriteAsync(new CatalogDocument(), "one")).Status);
    }
    [Fact]
    public async Task Lost_write_response_is_reloaded_without_retrying_the_write()
    {
        var store = new Store { LoseResponse = true };
        var (editor, coordinator, provider) = Create(store);
        await coordinator.RefreshAsync(default);
        var candidate = new CatalogDocument { Features = { new() { Key = "Checkout", Name = "Checkout", Enabled = true, Rules = { new() { Name = "AlwaysOn" } } } } };

        var result = await editor.TryWriteAsync(candidate, "one");

        Assert.Equal(CatalogWriteStatus.Written, result.Status);
        Assert.Equal(1, store.Writes);
        Assert.Equal("two", coordinator.Diagnostics.ActiveRevision);
        Assert.True(provider.TryGetFeatureModel("Checkout", out _));
    }

    [Fact]
    public async Task Oversized_mutation_does_not_reach_the_store()
    {
        var store = new Store();
        var (editor, _, _) = Create(store, maxBytes: 100);
        await Assert.ThrowsAsync<CatalogValidationException>(() => editor.TryWriteAsync(new CatalogDocument { Features = { new() { Key = "Checkout", Name = "Checkout", Description = new string('x', 200) } } }, "one"));
        Assert.Equal(0, store.Writes);
    }

    [Fact]
    public async Task Disappeared_catalog_cannot_be_initialized_over_a_loaded_runtime()
    {
        var store = new Store();
        var (editor, coordinator, _) = Create(store);
        await coordinator.RefreshAsync(default);
        store.Current = null;
        await coordinator.RefreshAsync(default);

        await Assert.ThrowsAsync<InvalidOperationException>(() => editor.TryWriteAsync(new CatalogDocument(), null));
        Assert.Equal(0, store.Writes);
        Assert.Equal(EmbeddedStorageState.Stale, coordinator.Diagnostics.StorageState);
    }

    private static (EmbeddedCatalogEditor, EmbeddedCatalogCoordinator, EmbeddedFeatureProvider) Create(Store store, long maxBytes = 10 * 1024 * 1024)
    {
        var options = Options.Create(new TogglyEmbeddedOptions { CatalogName = "Orders", MaxCatalogBytes = maxBytes });
        var provider = new EmbeddedFeatureProvider();
        var coordinator = new EmbeddedCatalogCoordinator(store, provider, options.Value);
        return (new EmbeddedCatalogEditor(store, coordinator, options), coordinator, provider);
    }

    private sealed class Store : ITogglyCatalogStore
    {
        public CatalogSnapshot? Current = new() { CatalogName = "Orders", Revision = "one", Document = new() };
        public bool LoseResponse;
        public bool ReadFailure;
        public int Writes;
        public CatalogStoreCapabilities Capabilities => new() { SupportsMultipleWriters = true };
        public Task<CatalogSnapshot?> ReadAsync(string catalogName, CancellationToken cancellationToken = default) => ReadFailure ? throw new IOException("Storage unavailable") : Task.FromResult(Current);
        public Task<CatalogWriteResult> TryWriteAsync(string catalogName, CatalogDocument document, string? expectedRevision, CancellationToken cancellationToken = default)
        {
            Writes++;
            if (Current?.Revision != expectedRevision) return Task.FromResult(CatalogWriteResult.Conflict(Current));
            Current = new() { CatalogName = catalogName, Revision = "two", Document = document };
            if (LoseResponse) throw new IOException("Response lost after commit");
            return Task.FromResult(CatalogWriteResult.Written(Current));
        }
    }
}
