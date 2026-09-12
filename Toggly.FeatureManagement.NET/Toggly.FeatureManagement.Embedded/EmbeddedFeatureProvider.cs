using Microsoft.FeatureManagement;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Embedded;

public sealed class EmbeddedFeatureProvider : IFeatureDefinitionProvider, IFeatureDefinitionModelProvider, ISecureFeatureProvider, IFeatureProviderDebug, IEvaluationSnapshotScope
{
    private EmbeddedCompiledSnapshot _current = new(string.Empty, new Dictionary<string, FeatureDefinitionModel>(StringComparer.Ordinal), new Dictionary<string, FeatureDefinition>(StringComparer.Ordinal));
    private readonly AsyncLocal<EmbeddedCompiledSnapshot?> _evaluationSnapshot = new();

    internal void Publish(EmbeddedCompiledSnapshot candidate) => Volatile.Write(ref _current, candidate);
    public bool TryGetFeatureModel(string featureKey, out FeatureDefinitionModel? definition) => CurrentSnapshot.Models.TryGetValue(featureKey, out definition);
    public bool IsFeatureSecured(string featureKey) => false;

    public async IAsyncEnumerable<FeatureDefinition> GetAllFeatureDefinitionsAsync()
    {
        var snapshot = CurrentSnapshot;
        foreach (var definition in snapshot.Definitions.Values) yield return definition;
        await Task.CompletedTask;
    }

    public Task<FeatureDefinition> GetFeatureDefinitionAsync(string featureName)
    {
        var snapshot = CurrentSnapshot;
        return Task.FromResult(snapshot.Definitions.TryGetValue(featureName, out var definition) ? definition : new FeatureDefinition { Name = featureName, EnabledFor = new List<FeatureFilterConfiguration>() });
    }

    public FeatureProviderDebugInfo GetDebugInfo() => new()
    {
        Definitions = new System.Collections.Concurrent.ConcurrentDictionary<string, FeatureDefinition>(CurrentSnapshot.Definitions, StringComparer.Ordinal),
        Loaded = true
    };

    IDisposable IEvaluationSnapshotScope.BeginScope()
    {
        var previous = _evaluationSnapshot.Value;
        _evaluationSnapshot.Value = Volatile.Read(ref _current);
        return new Scope(_evaluationSnapshot, previous);
    }

    private EmbeddedCompiledSnapshot CurrentSnapshot => _evaluationSnapshot.Value ?? Volatile.Read(ref _current);

    private sealed class Scope : IDisposable
    {
        private readonly AsyncLocal<EmbeddedCompiledSnapshot?> _snapshot;
        private readonly EmbeddedCompiledSnapshot? _previous;
        private bool _disposed;
        public Scope(AsyncLocal<EmbeddedCompiledSnapshot?> snapshot, EmbeddedCompiledSnapshot? previous) { _snapshot = snapshot; _previous = previous; }
        public void Dispose()
        {
            if (_disposed) return;
            _snapshot.Value = _previous;
            _disposed = true;
        }
    }
}
