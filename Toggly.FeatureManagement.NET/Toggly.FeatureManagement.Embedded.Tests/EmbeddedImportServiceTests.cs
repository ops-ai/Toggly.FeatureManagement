using Microsoft.Extensions.Options;
using Toggly.FeatureManagement.Catalog;
using Xunit;

namespace Toggly.FeatureManagement.Embedded.Tests;

public class EmbeddedImportServiceTests
{
    [Fact]
    public async Task ApplyAsync_ExplicitImportCreatesAnAbsentCatalogOnce()
    {
        var store = new MemoryStore(null);
        var options = Options.Create(new TogglyEmbeddedOptions { CatalogName = "Orders" });
        var editor = new EmbeddedCatalogEditor(store, new EmbeddedCatalogCoordinator(store, new EmbeddedFeatureProvider(), options.Value), options);
        var service = new EmbeddedImportService(editor, options);
        var preview = await service.PreviewAsync(CatalogJson.Serialize(new CatalogDocument { Features = { new() { Key = "Checkout", Name = "Checkout" } } }));
        Assert.Null(preview.ExpectedRevision);
        var result = await service.ApplyAsync(new(preview.CanonicalPayload, preview.Fingerprint, preview.ExpectedRevision, ["Checkout"], []));
        Assert.Equal(CatalogWriteStatus.Written, result.Status);
        Assert.Equal(1, store.WriteCount);
        Assert.Single(store.Current!.Document.Features);
        var repeated = await service.ApplyAsync(new(preview.CanonicalPayload, preview.Fingerprint, preview.ExpectedRevision, ["Checkout"], []));
        Assert.Equal(CatalogWriteStatus.Conflict, repeated.Status);
        Assert.Equal(1, store.WriteCount);
    }

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
                new CatalogFeature { Key = "Existing", Name = "Changed", Enabled = true, Rules = { new CatalogRule { Name = "AlwaysOn" } } },
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

    [Fact]
    public async Task ApplyAsync_MergesContextPropertiesWithoutRemovingExistingProperties()
    {
        var target = new CatalogDocument { Contexts = { Context("region") } };
        var (service, store) = CreateService(target);
        var preview = await service.PreviewAsync(CatalogJson.Serialize(new CatalogDocument { Contexts = { Context("tier") } }));

        Assert.Empty(preview.ContextConflictKinds);
        await service.ApplyAsync(new(preview.CanonicalPayload, preview.Fingerprint, preview.ExpectedRevision, [], []));

        Assert.Equal(new[] { "id", "region", "tier" }, store.Current!.Document.Contexts.Single().Properties.Select(p => p.Name).Order());
        Assert.Equal(1, store.WriteCount);
    }

    [Fact]
    public async Task ApplyAsync_CaseOnlyKeyCollisionCannotRenameExistingFeature()
    {
        var (service, store) = CreateService(new CatalogDocument { Features = { new() { Key = "Checkout", Name = "Original" } } });
        var preview = await service.PreviewAsync(CatalogJson.Serialize(new CatalogDocument { Features = { new() { Key = "checkout", Name = "Changed" } } }));

        Assert.Contains("checkout", preview.ConflictKeys);
        await Assert.ThrowsAsync<CatalogValidationException>(() => service.ApplyAsync(new(preview.CanonicalPayload, preview.Fingerprint, preview.ExpectedRevision, [], ["checkout"])));
        Assert.Equal("Checkout", store.Current!.Document.Features.Single().Key);
        Assert.Equal(0, store.WriteCount);
    }

    [Fact]
    public async Task ApplyAsync_ContextTypeConflictDoesNotPartiallyWriteFeatures()
    {
        var (service, store) = CreateService(new CatalogDocument { Contexts = { Context("tier") } });
        var changed = Context("tier");
        changed.Properties[1].Type = "number";
        var preview = await service.PreviewAsync(CatalogJson.Serialize(new CatalogDocument { Contexts = { changed }, Features = { new() { Key = "New", Name = "New" } } }));
        Assert.Contains("Account", preview.ContextConflictKinds);

        await Assert.ThrowsAsync<CatalogValidationException>(() => service.ApplyAsync(new(preview.CanonicalPayload, preview.Fingerprint, preview.ExpectedRevision, ["New"], [])));
        Assert.Empty(store.Current!.Document.Features);
        Assert.Equal(0, store.WriteCount);
    }

    [Fact]
    public async Task PreviewAsync_TreatsNullAndEmptyCategoryAsIdentical()
    {
        var (service, _) = CreateService(new CatalogDocument { Features = { new CatalogFeature { Key = "Checkout", Name = "Checkout", Category = null } } });
        var preview = await service.PreviewAsync(CatalogJson.Serialize(new CatalogDocument
        {
            Features = { new CatalogFeature { Key = "Checkout", Name = "Checkout", Category = "" } }
        }));

        Assert.Contains("Checkout", preview.IdenticalKeys);
        Assert.DoesNotContain("Checkout", preview.ConflictKeys);
    }

    [Fact]
    public async Task ApplyAsync_OverlaysImportedListsByKeyAndKeepsTargetOnlyLists()
    {
        var target = new CatalogDocument
        {
            Lists =
            {
                new CatalogList { Key = "beta", Name = "Beta", Description = "", Items = { "alice" } },
                new CatalogList { Key = "keep", Name = "Keep", Description = "", Items = { "local" } }
            }
        };
        var (service, store) = CreateService(target);
        var uploaded = CatalogJson.Serialize(new CatalogDocument
        {
            Lists =
            {
                new CatalogList { Key = "beta", Name = "Beta testers", Description = "", Items = { "bob" } },
                new CatalogList { Key = "staff", Name = "Staff", Description = "", Items = { "ops" } }
            }
        });

        var preview = await service.PreviewAsync(uploaded);
        await service.ApplyAsync(new(preview.CanonicalPayload, preview.Fingerprint, preview.ExpectedRevision, [], []));

        var lists = store.Current!.Document.Lists.OrderBy(list => list.Key).ToList();
        Assert.Equal(new[] { "beta", "keep", "staff" }, lists.Select(list => list.Key));
        Assert.Equal(new[] { "bob" }, lists.Single(list => list.Key == "beta").Items);
        Assert.Equal("Beta testers", lists.Single(list => list.Key == "beta").Name);
        Assert.Equal(new[] { "local" }, lists.Single(list => list.Key == "keep").Items);
    }

    private static CatalogContextSchema Context(string property) => new()
    {
        Kind = "Account", KeyPropertyName = "id",
        Properties = { new() { Name = "id", Type = "string" }, new() { Name = property, Type = "string" } }
    };

    private static (EmbeddedImportService Service, MemoryStore Store) CreateService(CatalogDocument document)
    {
        var store = new MemoryStore(new CatalogSnapshot { CatalogName = "Orders", Revision = "one", Document = document });
        var options = Options.Create(new TogglyEmbeddedOptions { CatalogName = "Orders" });
        var editor = new EmbeddedCatalogEditor(store, new EmbeddedCatalogCoordinator(store, new EmbeddedFeatureProvider(), options.Value), options);
        return (new EmbeddedImportService(editor, options), store);
    }

    private sealed class MemoryStore(CatalogSnapshot? current) : ITogglyCatalogStore
    {
        public CatalogSnapshot? Current { get; set; } = current;
        public int WriteCount { get; private set; }
        public CatalogStoreCapabilities Capabilities => new() { SupportsMultipleWriters = true };
        public Task<CatalogSnapshot?> ReadAsync(string catalogName, CancellationToken cancellationToken = default) => Task.FromResult(Current);
        public Task<CatalogWriteResult> TryWriteAsync(string catalogName, CatalogDocument document, string? expectedRevision, CancellationToken cancellationToken = default)
        {
            if (!string.Equals(Current?.Revision, expectedRevision, StringComparison.Ordinal))
                return Task.FromResult(CatalogWriteResult.Conflict(Current));
            WriteCount++;
            Current = new CatalogSnapshot { CatalogName = catalogName, Revision = "two", UpdatedAtUtc = DateTimeOffset.UtcNow, Document = document };
            return Task.FromResult(CatalogWriteResult.Written(Current));
        }
    }
}
