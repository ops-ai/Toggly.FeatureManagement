using Microsoft.Extensions.Options;
using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Embedded;

/// <summary>
/// Performs authoritative, optimistic-concurrency catalog edits for an embedded host.
/// </summary>
public sealed class EmbeddedCatalogEditor
{
    private readonly ITogglyCatalogStore _store;
    private readonly EmbeddedCatalogCoordinator _coordinator;
    private readonly TogglyEmbeddedOptions _options;

    internal EmbeddedCatalogEditor(ITogglyCatalogStore store, EmbeddedCatalogCoordinator coordinator, IOptions<TogglyEmbeddedOptions> options)
    {
        _store = store;
        _coordinator = coordinator;
        _options = options.Value;
    }

    /// <summary>Reads a detached authoritative snapshot.</summary>
    public async Task<CatalogSnapshot?> ReadAsync(CancellationToken cancellationToken = default)
    {
        var snapshot = await _store.ReadAsync(_options.CatalogName!, cancellationToken).ConfigureAwait(false);
        return snapshot == null ? null : CloneSnapshot(snapshot);
    }

    /// <summary>Writes a complete catalog when its expected revision is current.</summary>
    public async Task<CatalogWriteResult> TryWriteAsync(CatalogDocument document, string? expectedRevision, CancellationToken cancellationToken = default)
    {
        EnsureWritable();
        var canonical = CatalogJson.Parse(CatalogJson.Serialize(document));
        var result = await _store.TryWriteAsync(_options.CatalogName!, canonical, expectedRevision, cancellationToken).ConfigureAwait(false);
        if (result.Status == CatalogWriteStatus.Written)
        {
            await _coordinator.RefreshAsync(cancellationToken).ConfigureAwait(false);
        }

        return result;
    }

    private void EnsureWritable()
    {
        if (_options.ReadOnly)
        {
            throw new InvalidOperationException("The embedded catalog is configured read-only.");
        }
    }

    private static CatalogSnapshot CloneSnapshot(CatalogSnapshot snapshot) => new()
    {
        CatalogName = snapshot.CatalogName,
        Revision = snapshot.Revision,
        UpdatedAtUtc = snapshot.UpdatedAtUtc,
        Document = CatalogJson.Parse(CatalogJson.Serialize(snapshot.Document))
    };
}
