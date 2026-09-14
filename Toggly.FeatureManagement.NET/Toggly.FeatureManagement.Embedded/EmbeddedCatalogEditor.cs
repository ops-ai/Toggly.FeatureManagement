using Microsoft.Extensions.Options;
using System.Text;
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
    private readonly EmbeddedContextSchemaProvider? _contextSchemas;

    internal EmbeddedCatalogEditor(ITogglyCatalogStore store, EmbeddedCatalogCoordinator coordinator, IOptions<TogglyEmbeddedOptions> options, EmbeddedContextSchemaProvider? contextSchemas = null)
    {
        _store = store;
        _coordinator = coordinator;
        _options = options.Value;
        _contextSchemas = contextSchemas;
    }

    /// <summary>Reads a detached authoritative snapshot.</summary>
    public async Task<CatalogSnapshot?> ReadAsync(CancellationToken cancellationToken = default)
    {
        var snapshot = await _store.ReadAsync(_options.CatalogName!, cancellationToken).ConfigureAwait(false);
        if (snapshot == null && _coordinator.Diagnostics.ActiveRevision != null)
            throw new InvalidOperationException("The previously loaded catalog is missing from authoritative storage.");
        return snapshot == null ? null : CloneSnapshot(snapshot);
    }

    /// <summary>Writes a complete catalog when its expected revision is current.</summary>
    public async Task<CatalogWriteResult> TryWriteAsync(CatalogDocument document, string? expectedRevision, CancellationToken cancellationToken = default)
    {
        EnsureWritable();
        if (expectedRevision == null && _coordinator.Diagnostics.ActiveRevision != null)
            throw new InvalidOperationException("A previously loaded catalog cannot be reinitialized. Restore the authoritative storage first.");
        var payload = CatalogJson.Serialize(RetainReferencedSchemas(document));
        if (Encoding.UTF8.GetByteCount(payload) > _options.MaxCatalogBytes)
            throw new CatalogValidationException([new CatalogValidationError("document", "The catalog exceeds the configured maximum size.")]);
        var canonical = CatalogJson.Parse(payload);
        CatalogWriteResult result;
        try
        {
            result = await _store.TryWriteAsync(_options.CatalogName!, canonical, expectedRevision, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception)
        {
            // A store may have committed before the transport failed. Resolve against
            // authoritative storage once; never repeat the write with a new revision.
            using var recovery = new CancellationTokenSource(_options.InitialLoadTimeout);
            var current = await _store.ReadAsync(_options.CatalogName!, recovery.Token).WaitAsync(recovery.Token).ConfigureAwait(false);
            if (current == null || string.Equals(current.Revision, expectedRevision, StringComparison.Ordinal)) throw;
            result = string.Equals(CatalogJson.Serialize(current.Document), payload, StringComparison.Ordinal)
                ? CatalogWriteResult.Written(CloneSnapshot(current))
                : CatalogWriteResult.Conflict(CloneSnapshot(current));
        }
        if (result.Status == CatalogWriteStatus.Written)
        {
            using var refresh = new CancellationTokenSource(_options.InitialLoadTimeout);
            await _coordinator.RefreshAsync(refresh.Token).ConfigureAwait(false);
        }

        return result;
    }

    private void EnsureWritable()
    {
        if (_options.ReadOnly || _store.Capabilities.IsReadOnly)
        {
            throw new InvalidOperationException("The embedded catalog is configured read-only.");
        }
        if (_coordinator.Diagnostics.StorageState is EmbeddedStorageState.Unavailable or EmbeddedStorageState.Stale)
            throw new InvalidOperationException("Catalog writes are unavailable until storage refresh succeeds.");
    }

    private CatalogDocument RetainReferencedSchemas(CatalogDocument document)
    {
        if (_contextSchemas == null || document.Features == null || document.Contexts == null) return document;
        var contexts = document.Contexts.ToList();
        foreach (var schema in _contextSchemas.GetRegisteredSchemas())
        {
            if (!document.Features.Any(feature => feature != null && string.Equals(feature.ContextKind, schema.Kind, StringComparison.OrdinalIgnoreCase))) continue;
            var retained = contexts.SingleOrDefault(context => context != null && string.Equals(context.Kind, schema.Kind, StringComparison.OrdinalIgnoreCase));
            if (retained == null) contexts.Add(schema);
            else
            {
                if (!string.Equals(retained.KeyPropertyName, schema.KeyPropertyName, StringComparison.Ordinal) ||
                    schema.Properties.Any(property => retained.Properties.Any(existing => string.Equals(existing.Name, property.Name, StringComparison.OrdinalIgnoreCase) &&
                        (!string.Equals(existing.Name, property.Name, StringComparison.Ordinal) || existing.Type != property.Type))))
                    throw new CatalogValidationException([new CatalogValidationError("contexts", $"Registered context '{schema.Kind}' conflicts with its retained schema.")]);
                contexts[contexts.IndexOf(retained)] = new CatalogContextSchema
                {
                    Kind = retained.Kind, KeyPropertyName = retained.KeyPropertyName,
                    Properties = retained.Properties.Concat(schema.Properties.Where(property => !retained.Properties.Any(existing => string.Equals(existing.Name, property.Name, StringComparison.OrdinalIgnoreCase)))).ToList()
                };
            }
        }
        return new CatalogDocument { SchemaVersion = document.SchemaVersion, Environment = document.Environment, Features = document.Features, Contexts = contexts, Lists = document.Lists };
    }

    private static CatalogSnapshot CloneSnapshot(CatalogSnapshot snapshot) => new()
    {
        CatalogName = snapshot.CatalogName,
        Revision = snapshot.Revision,
        UpdatedAtUtc = snapshot.UpdatedAtUtc,
        Document = CatalogJson.Parse(CatalogJson.Serialize(snapshot.Document))
    };
}
