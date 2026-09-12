using Microsoft.FeatureManagement;
using System.Collections.ObjectModel;
using Toggly.FeatureManagement.Client;
using Toggly.FeatureManagement.Context;
namespace Toggly.FeatureManagement.Blazor.Server;

/// <summary>Scoped session over the shared trusted definition provider.</summary>
public sealed class ServerFeatureSession : IFeatureSession
{
    private readonly IFeatureManager manager;
    private readonly IFeatureStateService? states;
    private readonly Guid subscription;
    private EvaluationContext context = new();
    private bool disposed;
    public ServerFeatureSession(IFeatureManager manager, IFeatureStateService? states = null)
    {
        this.manager = manager; this.states = states;
        subscription = states?.WhenDefinitionsChange(() => { if (!disposed) Changed?.Invoke(this, EventArgs.Empty); }) ?? Guid.Empty;
    }
    public bool IsReady { get; private set; }
    public bool RequiresBrowser => false;
    public event EventHandler? Changed;
    public event EventHandler<Exception>? Error;
    public Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(disposed, this); cancellationToken.ThrowIfCancellationRequested();
        IsReady = true; Changed?.Invoke(this, EventArgs.Empty); return Task.CompletedTask;
    }
    /// <summary>Re-evaluate cached definitions. The trusted provider owns polling and push refresh.</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => InitializeAsync(cancellationToken);
    public Task SetContextAsync(EvaluationContext value, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(disposed, this); ArgumentNullException.ThrowIfNull(value); cancellationToken.ThrowIfCancellationRequested();
        // Custom filters must not be able to mutate a later circuit evaluation.
        var groups = value.Groups is null ? null : Array.AsReadOnly(value.Groups.ToArray());
        var claims = value.Claims is null ? null : new ReadOnlyDictionary<string,string>(new Dictionary<string,string>(value.Claims));
        Volatile.Write(ref context, new(value.Identity, groups, claims));
        Changed?.Invoke(this, EventArgs.Empty); return Task.CompletedTask;
    }
    public async Task<bool> EvaluateAsync(IEnumerable<string> keys, Requirement requirement = Requirement.All, bool negate = false, EntityContext? entity = null)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        using var scope = BlazorTargetingContext.Enter(Volatile.Read(ref context));
        try
        {
            var results = new List<bool>();
            foreach (var key in keys)
                results.Add(entity is null ? await manager.IsEnabledAsync(key) : await manager.IsEnabledAsync(key, new TogglyEvaluationContext(new TogglyEntityContext(entity.Kind, entity.Key, entity.Attributes))));
            var result = results.Count == 0 || (requirement == Requirement.Any ? results.Any(x => x) : results.All(x => x));
            return negate ? !result : result;
        }
        catch (Exception exception) { Error?.Invoke(this, exception); throw; }
    }
    public ValueTask DisposeAsync()
    {
        if (disposed) return ValueTask.CompletedTask;
        disposed = true;
        if (states is not null) states.UnregisterDefinitionsChange(subscription);
        Changed = null; Error = null;
        return ValueTask.CompletedTask;
    }
}
