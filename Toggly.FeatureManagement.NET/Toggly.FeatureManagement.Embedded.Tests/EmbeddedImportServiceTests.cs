using Microsoft.Extensions.Options;
using Toggly.FeatureManagement.Catalog;
using Xunit;

namespace Toggly.FeatureManagement.Embedded.Tests;

public class EmbeddedImportServiceTests
{
    [Fact]
    public async Task ApplyAsync_MergesSelectedFeaturesWithOneRevisionBoundWrite()
    {
        var store = new MemoryStore(new CatalogSnapshot
        {
            CatalogName = "Orders", Revision = "one", UpdatedAtUtc = DateTimeOffset.UtcNow,
            Document = new CatalogDocument { Features = { new CatalogFeature { Key = "Existing", Name = "Existing", Enabled = false } } }
        });
        var options = Options.Create(new TogglyEmbeddedOptions { CatalogName = "Orders" });
        var editor = new EmbeddedCatalogEditor(store, new EmbeddedCatalogCoordinator(store, new EmbeddedFeatureProvider(), options.Value), options);
        var service = new EmbeddedImportService(editor, options);
        var uploaded = CatalogJson.Serialize(new CatalogDocument
        {
            Features =
            {
                new CatalogFeature { Key = "Existing", Name = "Changed", Enabled = true },
                new CatalogFeature { Key = "NewCheckout", Name = "New checkout", Enabled = false }
            }
        });

        var preview = await service.PreviewAsync(uploaded);
        var result = await service.ApplyAsync(new EmbeddedImportApplyRequest(preview.CanonicalPayload, preview.Fingerprint, preview.ExpectedRevision, ["NewCheckout"], []));

        Assert.Equal(CatalogWriteStatus.Written, result.Status);
        Assert.Equal(1, store.WriteCount);
        Assert.Contains(store.Current!.Document.Features, feature => feature.Key == "Existing" && feature.Name == "Existing");
        Assert.Contains(store.Current.Document.Features, feature => feature.Key == "NewCheckout");
    }

    [Fact]
    public async Task ApplyAsync_RejectsAStalePreviewWithoutWriting()
    {
        var store = new MemoryStore(new CatalogSnapshot { CatalogName = "Orders", Revision = "one", UpdatedAtUtc = DateTimeOffset.UtcNow, Document = new CatalogDocument() });
        var options = Options.Create(new TogglyEmbeddedOptions { CatalogName = "Orders" });
        var editor = new EmbeddedCatalogEditor(store, new EmbeddedCatalogCoordinator(store, new EmbeddedFeatureProvider(), options.Value), options);
        var service = new EmbeddedImportService(editor, options);
        var preview = await service.PreviewAsync(CatalogJson.Serialize(new CatalogDocument { Features = { new CatalogFeature { Key = "NewCheckout", Name = "New checkout" } } }));
        store.Current!.Revision = "two";

        var result = await service.ApplyAsync(new EmbeddedImportApplyRequest(preview.CanonicalPayload, preview.Fingerprint, preview.ExpectedRevision, ["NewCheckout"], []));

        Assert.Equal(CatalogWriteStatus.Conflict, result.Status);
        Assert.Equal(0, store.WriteCount);
    }

    private sealed class MemoryStore(CatalogSnapshot? current) : ITogglyCatalogStore
    {
        public CatalogSnapshot? Current { get; set; } = current;
        public int WriteCount { get; private set; }
        public CatalogStoreCapabilities Capabilities => new() { SupportsMultipleWriters = true };
        public Task<CatalogSnapshot?> ReadAsync(string catalogName, CancellationToken cancellationToken = default) => Task.FromResult(Current);
        public Task<CatalogWriteResult> TryWriteAsync(string catalogName, CatalogDocument document, string? expectedRevision, CancellationToken cancellationToken = default)
        {
            if (Current == null || !string.Equals(Current.Revision, expectedRevision, StringComparison.Ordinal))
                return Task.FromResult(CatalogWriteResult.Conflict(Current));
            WriteCount++;
            Current = new CatalogSnapshot { CatalogName = catalogName, Revision = "two", UpdatedAtUtc = DateTimeOffset.UtcNow, Document = document };
            return Task.FromResult(CatalogWriteResult.Written(Current));
        }
    }
}
