using Toggly.FeatureManagement.Client;

namespace Toggly.FeatureManagement.Blazor;

/// <summary>Owns a portable client for a single browser DI scope.</summary>
public sealed class BrowserFeatureSession : IFeatureSession, IFrontendTelemetry
{
    private readonly TogglyClient client;
    private readonly BrowserTelemetryLifecycle? telemetryLifecycle;

    public BrowserFeatureSession(TogglyClient client)
    {
        this.client = client;
        client.Changed += OnChanged;
    }

    public BrowserFeatureSession(TogglyClient client, BrowserTelemetryLifecycle telemetryLifecycle) : this(client)
    {
        this.telemetryLifecycle = telemetryLifecycle;
    }

    public void RecordUsage(string featureKey, string variant = "enabled") => client.RecordUsage(featureKey, variant);
    public void RecordView(string featureKey, string variant = "enabled") => client.RecordView(featureKey, variant);
    public void IncrementCounter(string metricKey, double value = 1) => client.IncrementCounter(metricKey, value);
    public void SetGauge(string metricKey, double value) => client.SetGauge(metricKey, value);
    public Task FlushTelemetryAsync(CancellationToken cancellationToken = default) => client.FlushTelemetryAsync(cancellationToken);

    private void OnChanged(object? sender, EventArgs args) => Changed?.Invoke(this, args);

    public bool IsReady => client.IsReady;
    public bool RequiresBrowser => true;
    public event EventHandler? Changed;
    public event EventHandler<Exception>? Error
    {
        add => client.Error += value;
        remove => client.Error -= value;
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        if (telemetryLifecycle is not null)
            await telemetryLifecycle.AttachAsync(client);
        await client.InitializeAsync(cancellationToken);
        Changed?.Invoke(this, EventArgs.Empty);
    }

    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        await client.RefreshAsync(cancellationToken);
        Changed?.Invoke(this, EventArgs.Empty);
    }

    public Task SetContextAsync(
        EvaluationContext context,
        CancellationToken cancellationToken = default
    ) => client.SetContextAsync(context, cancellationToken);

    public Task<bool> EvaluateAsync(
        IEnumerable<string> keys,
        Requirement requirement = Requirement.All,
        bool negate = false,
        EntityContext? entity = null
    ) => Task.FromResult(client.Evaluate(keys, requirement, negate, entity));

    public async ValueTask DisposeAsync()
    {
        client.Changed -= OnChanged;
        Changed = null;
        var detach = telemetryLifecycle?.DisposeAsync().AsTask() ?? Task.CompletedTask;
        await Task.WhenAll(detach, client.DisposeAsync().AsTask());
    }
}
