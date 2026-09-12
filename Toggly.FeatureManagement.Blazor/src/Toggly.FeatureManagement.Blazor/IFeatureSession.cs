using Toggly.FeatureManagement.Client;

namespace Toggly.FeatureManagement.Blazor;

/// <summary>One request, interactive circuit, or browser tab. Never register as a singleton.</summary>
public interface IFeatureSession : IAsyncDisposable
{
    /// <summary>Whether initialization has attempted to load definitions; defaults may still be in use.</summary>
    bool IsReady
    {
        get;
    }

    /// <summary>Whether initialization must wait until JavaScript interop is available.</summary>
    bool RequiresBrowser
    {
        get;
    }

    /// <summary>Raised when consumers should reevaluate their current scoped context.</summary>
    event EventHandler? Changed;

    /// <summary>Reports refresh, verification or evaluation errors without replacing valid cached definitions.</summary>
    event EventHandler<Exception>? Error;

    /// <summary>Initializes the session for its host lifecycle.</summary>
    Task InitializeAsync(CancellationToken cancellationToken = default);

    /// <summary>Refreshes browser definitions or reevaluates the trusted server provider’s current definitions.</summary>
    Task RefreshAsync(CancellationToken cancellationToken = default);

    /// <summary>Replaces this session’s targeting context without sharing it with other users.</summary>
    Task SetContextAsync(EvaluationContext context, CancellationToken cancellationToken = default);

    /// <summary>Evaluates keys with all/any, optional negation and per-read entity attributes.</summary>
    Task<bool> EvaluateAsync(
        IEnumerable<string> keys,
        Requirement requirement = Requirement.All,
        bool negate = false,
        EntityContext? entity = null
    );
}
