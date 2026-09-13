using System.Text;
using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Embedded;

public sealed class EmbeddedCatalogCoordinator : IDisposable
{
    private readonly ITogglyCatalogStore _store;
    private readonly EmbeddedFeatureProvider _provider;
    private readonly TogglyEmbeddedOptions _options;
    private readonly IFeatureStateInternalService? _stateService;
    private readonly IEmbeddedClock _clock;
    private readonly SemaphoreSlim _refreshGate = new(1, 1);
    private readonly object _diagnosticsLock = new();
    private Dictionary<string, bool> _activeFeatureStates = new(StringComparer.Ordinal);
    private bool _hasPublished;
    private string? _activeContent;
    private Task<CatalogSnapshot?>? _pendingRead;
    private CancellationTokenSource? _readCancellation;

    internal EmbeddedCatalogCoordinator(ITogglyCatalogStore store, EmbeddedFeatureProvider provider, TogglyEmbeddedOptions options, IFeatureStateInternalService? stateService = null, IEmbeddedClock? clock = null)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _provider = provider ?? throw new ArgumentNullException(nameof(provider));
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _stateService = stateService;
        _clock = clock ?? new SystemEmbeddedClock();
        Diagnostics = new EmbeddedRuntimeDiagnostics { ReadOnly = options.ReadOnly || store.Capabilities.IsReadOnly, IsWriter = !options.ReadOnly && !store.Capabilities.IsReadOnly };
    }

    public EmbeddedRuntimeDiagnostics Diagnostics { get; }

    public Task RefreshAsync(CancellationToken cancellationToken) => RefreshAsync(cancellationToken, null);

    internal async Task RefreshAsync(CancellationToken cancellationToken, TimeSpan? readTimeout)
    {
        await _refreshGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_pendingRead is { IsCanceled: true } or { IsFaulted: true }) ClearRead();
            if (_pendingRead == null)
            {
                _readCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                _pendingRead = _store.ReadAsync(_options.CatalogName!, _readCancellation.Token);
                _ = _pendingRead.ContinueWith(task => _ = task.Exception,
                    TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously);
            }
            // Keep ownership of timed-out reads until they finish, including stores
            // which ignore cancellation. A later tick must not launch another read.
            var snapshot = await _pendingRead.WaitAsync(readTimeout ?? _options.InitialLoadTimeout, cancellationToken).ConfigureAwait(false);
            if (snapshot == null) { SetMissing(); return; }
            var content = CatalogJson.Serialize(snapshot.Document);
            if (Encoding.UTF8.GetByteCount(content) > _options.MaxCatalogBytes)
                throw new InvalidOperationException("The stored catalog exceeds the configured maximum size.");
            if (_hasPublished && string.Equals(Diagnostics.ActiveRevision, snapshot.Revision, StringComparison.Ordinal))
            {
                if (!string.Equals(_activeContent, content, StringComparison.Ordinal))
                    throw new InvalidOperationException("The stored catalog changed without a new revision.");
                lock (_diagnosticsLock)
                {
                    Diagnostics.LastSuccessfulRefreshUtc = _clock.UtcNow;
                    Diagnostics.StorageState = EmbeddedStorageState.Available;
                    Diagnostics.LastError = null;
                }
                return;
            }
            var candidate = EmbeddedCatalogCompiler.Compile(snapshot);
            _provider.Publish(candidate);
            _hasPublished = true;
            _activeContent = content;
            lock (_diagnosticsLock)
            {
                Diagnostics.ActiveRevision = snapshot.Revision;
                Diagnostics.LastSuccessfulRefreshUtc = _clock.UtcNow;
                Diagnostics.StorageState = EmbeddedStorageState.Available;
                Diagnostics.LastError = null;
            }
            var nextStates = snapshot.Document.Features.ToDictionary(feature => feature.Key, feature => feature.Enabled && feature.Rules.Count == 0, StringComparer.Ordinal);
            foreach (var deletedKey in _activeFeatureStates.Keys.Except(nextStates.Keys, StringComparer.Ordinal))
                _stateService?.UpdateFeatureState(deletedKey, false);
            foreach (var state in nextStates)
                _stateService?.UpdateFeatureState(state.Key, state.Value);
            _activeFeatureStates = nextStates;
            _stateService?.NotifyDefinitionsChanged();
        }
        catch (Exception exception)
        {
            _readCancellation?.Cancel();
            SetFailure(exception);
        }
        finally
        {
            if (_pendingRead == null || _pendingRead.IsCompleted) ClearRead();
            _refreshGate.Release();
        }
    }

    private void ClearRead()
    {
        _pendingRead = null;
        _readCancellation?.Dispose();
        _readCancellation = null;
    }

    public void Dispose()
    {
        _readCancellation?.Cancel();
        _readCancellation?.Dispose();
        _refreshGate.Dispose();
    }

    private void SetMissing()
    {
        lock (_diagnosticsLock)
        {
            Diagnostics.StorageState = _hasPublished ? EmbeddedStorageState.Stale : EmbeddedStorageState.Uninitialized;
            Diagnostics.LastError = _hasPublished ? "Catalog storage no longer contains the active catalog." : null;
        }
    }

    private void SetFailure(Exception exception)
    {
        lock (_diagnosticsLock)
        {
            Diagnostics.StorageState = _hasPublished ? EmbeddedStorageState.Stale : EmbeddedStorageState.Unavailable;
            Diagnostics.LastError = exception is TimeoutException
                ? "Catalog storage did not respond before the configured timeout."
                : "Catalog storage could not supply a valid snapshot.";
        }
    }
}
