namespace Toggly.FeatureManagement.Embedded;

internal sealed class NoOpUsageStatsProvider : IFeatureUsageStatsProvider, IUsageStatsDebug
{
    public Task RecordCheckAsync(string featureKey, bool allowed) => Task.CompletedTask;
    public Task RecordUsageAsync<TContext>(string featureKey, TContext context, bool allowed) => Task.CompletedTask;
    public Task RecordUsageAsync(string featureKey) => Task.CompletedTask;
    public Task RecordUsageAsync<TContext>(string featureKey, TContext context) => Task.CompletedTask;
    public Task RecordViewAsync(string featureKey) => Task.CompletedTask;
    public Task RecordViewAsync<TContext>(string featureKey, TContext context) => Task.CompletedTask;
    public void RecordDefinitionCacheHit() { }
    public void RecordDefinitionCacheMiss() { }
    public UsageStatsDebugInfo GetDebugInfo() => new();
}

internal sealed class NoOpMetricsService : IMetricsService, IMetricsDebug
{
    public Task AddMetricAsync(string metricKey, int value) => Task.CompletedTask;
    public Task AddMetricAsync<TContext>(string metricKey, TContext context, int value) => Task.CompletedTask;
    public Task MeasureAsync(string metricKey, double value) => Task.CompletedTask;
    public Task MeasureAsync<TContext>(string metricKey, TContext context, double value) => Task.CompletedTask;
    public Task ObserveAsync(string metricKey, double value) => Task.CompletedTask;
    public Task ObserveAsync<TContext>(string metricKey, TContext context, double value) => Task.CompletedTask;
    public Task IncrementCounterAsync(string metricKey, double value) => Task.CompletedTask;
    public Task IncrementCounterAsync<TContext>(string metricKey, TContext context, double value) => Task.CompletedTask;
    public MetricsDebugInfo GetDebugInfo() => new();
}
