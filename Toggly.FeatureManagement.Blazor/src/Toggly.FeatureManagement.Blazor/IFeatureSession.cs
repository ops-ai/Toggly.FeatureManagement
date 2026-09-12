using Toggly.FeatureManagement.Client;
namespace Toggly.FeatureManagement.Blazor;

/// <summary>One request, interactive circuit, or browser tab. Never register as a singleton.</summary>
public interface IFeatureSession : IAsyncDisposable
{
    bool IsReady { get; }
    bool RequiresBrowser { get; }
    event EventHandler? Changed;
    event EventHandler<Exception>? Error;
    Task InitializeAsync(CancellationToken cancellationToken = default);
    Task RefreshAsync(CancellationToken cancellationToken = default);
    Task SetContextAsync(EvaluationContext context, CancellationToken cancellationToken = default);
    Task<bool> EvaluateAsync(IEnumerable<string> keys, Requirement requirement = Requirement.All, bool negate = false, EntityContext? entity = null);
}
