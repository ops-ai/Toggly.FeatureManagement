using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Embedded;

public sealed class EmbeddedCatalogCoordinator
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

    internal EmbeddedCatalogCoordinator(ITogglyCatalogStore store, EmbeddedFeatureProvider provider, TogglyEmbeddedOptions options, IFeatureStateInternalService? stateService = null, IEmbeddedClock? clock = null)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _provider = provider ?? throw new ArgumentNullException(nameof(provider));
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _stateService = stateService;
        _clock = clock ?? new SystemEmbeddedClock();
        Diagnostics = new EmbeddedRuntimeDiagnostics { ReadOnly = options.ReadOnly, IsWriter = !options.ReadOnly };
    }

    public EmbeddedRuntimeDiagnostics Diagnostics { get; }

    public Task RefreshAsync(CancellationToken cancellationToken) => RefreshAsync(cancellationToken, null);

    internal async Task RefreshAsync(CancellationToken cancellationToken, TimeSpan? readTimeout)
    {
        if (!await _refreshGate.WaitAsync(0, cancellationToken).ConfigureAwait(false)) return;
        try
        {
            var readTask = _store.ReadAsync(_options.CatalogName!, cancellationToken);
            CatalogSnapshot? snapshot;
            if (readTimeout.HasValue)
            {
                var timeoutTask = Task.Delay(readTimeout.Value);
                var cancellationTask = Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                var completed = await Task.WhenAny(readTask, timeoutTask, cancellationTask).ConfigureAwait(false);
                if (completed == timeoutTask)
                {
                    _ = readTask.ContinueWith(task => _ = task.Exception, TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously);
                    SetFailure(new TimeoutException("Initial embedded catalog load timed out."));
                    return;
                }
                if (completed == cancellationTask) throw new OperationCanceledException(cancellationToken);
            }
            snapshot = await readTask.ConfigureAwait(false);
            if (snapshot == null) { SetMissing(); return; }
            if (_hasPublished && string.Equals(Diagnostics.ActiveRevision, snapshot.Revision, StringComparison.Ordinal))
            {
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
            SetFailure(exception);
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

    private void SetFailure(Exception exception)
    {
        lock (_diagnosticsLock)
        {
            Diagnostics.StorageState = _hasPublished ? EmbeddedStorageState.Stale : EmbeddedStorageState.Unavailable;
            Diagnostics.LastError = exception.Message;
        }
    }
}
