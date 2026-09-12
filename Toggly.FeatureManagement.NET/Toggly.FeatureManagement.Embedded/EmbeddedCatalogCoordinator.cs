using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Embedded;

public sealed class EmbeddedCatalogCoordinator
{
    private readonly ITogglyCatalogStore _store;
    private readonly EmbeddedFeatureProvider _provider;
    private readonly TogglyEmbeddedOptions _options;
    private readonly IFeatureStateInternalService? _stateService;
    private readonly SemaphoreSlim _refreshGate = new(1, 1);
    private readonly object _diagnosticsLock = new();
    private bool _hasPublished;

    internal EmbeddedCatalogCoordinator(ITogglyCatalogStore store, EmbeddedFeatureProvider provider, TogglyEmbeddedOptions options, IFeatureStateInternalService? stateService = null)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _provider = provider ?? throw new ArgumentNullException(nameof(provider));
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _stateService = stateService;
        Diagnostics = new EmbeddedRuntimeDiagnostics { ReadOnly = options.ReadOnly, IsWriter = !options.ReadOnly };
    }

    public EmbeddedRuntimeDiagnostics Diagnostics { get; }

    public async Task RefreshAsync(CancellationToken cancellationToken)
    {
        if (!await _refreshGate.WaitAsync(0, cancellationToken).ConfigureAwait(false)) return;
        try
        {
            var snapshot = await _store.ReadAsync(_options.CatalogName!, cancellationToken).ConfigureAwait(false);
            if (snapshot == null) { SetMissing(); return; }
            var candidate = EmbeddedCatalogCompiler.Compile(snapshot);
            _provider.Publish(candidate);
            _hasPublished = true;
            lock (_diagnosticsLock)
            {
                Diagnostics.ActiveRevision = snapshot.Revision;
                Diagnostics.LastSuccessfulRefreshUtc = DateTimeOffset.UtcNow;
                Diagnostics.StorageState = EmbeddedStorageState.Available;
                Diagnostics.LastError = null;
            }
            foreach (var feature in snapshot.Document.Features)
                _stateService?.UpdateFeatureState(feature.Key, feature.Enabled && feature.Rules.Count == 0);
            _stateService?.NotifyDefinitionsChanged();
        }
        catch (Exception exception)
        {
            lock (_diagnosticsLock)
            {
                Diagnostics.StorageState = _hasPublished ? EmbeddedStorageState.Stale : EmbeddedStorageState.Unavailable;
                Diagnostics.LastError = exception.Message;
            }
        }
        finally { _refreshGate.Release(); }
    }

    private void SetMissing()
    {
        lock (_diagnosticsLock)
        {
            Diagnostics.StorageState = _hasPublished ? EmbeddedStorageState.Stale : EmbeddedStorageState.Available;
            Diagnostics.LastError = _hasPublished ? "Catalog storage no longer contains the active catalog." : null;
        }
    }
}
