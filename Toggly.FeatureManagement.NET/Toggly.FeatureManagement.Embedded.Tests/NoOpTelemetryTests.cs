using System.Runtime.CompilerServices;
using Xunit;

namespace Toggly.FeatureManagement.Embedded.Tests;

public sealed class NoOpTelemetryTests
{
    [Fact]
    public void Offline_telemetry_completes_synchronously_without_retaining_entities_or_fabricating_counts()
    {
        var usage = new NoOpUsageStatsProvider(); var metrics = new NoOpMetricsService();
        var entity = ExerciseTelemetry(usage, metrics);
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        Assert.False(entity.IsAlive);
        var usageInfo = usage.GetDebugInfo(); var metricInfo = metrics.GetDebugInfo();
        Assert.Null(usageInfo.UniqueUsageEnabledMap); Assert.Null(usageInfo.UniqueUsageDisabledMap); Assert.Null(usageInfo.UniqueUsageUsedMap);
        Assert.Null(usageInfo.LastSend); Assert.Null(usageInfo.BaseUrl); Assert.Null(usageInfo.AppKey);
        Assert.Null(metricInfo.Stats); Assert.Null(metricInfo.LastSend); Assert.Null(metricInfo.BaseUrl); Assert.Null(metricInfo.AppKey);
        GC.KeepAlive(usage); GC.KeepAlive(metrics);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static WeakReference ExerciseTelemetry(NoOpUsageStatsProvider usage, NoOpMetricsService metrics)
    {
        var entity = new object();
        for (var i = 0; i < 100; i++)
        {
            Task[] calls = [usage.RecordCheckAsync("Feature", true), usage.RecordUsageAsync("Feature", entity, true),
                usage.RecordUsageAsync("Feature"), usage.RecordUsageAsync("Feature", entity), usage.RecordViewAsync("Feature"), usage.RecordViewAsync("Feature", entity),
                metrics.AddMetricAsync("Metric", 1), metrics.AddMetricAsync("Metric", entity, 1), metrics.MeasureAsync("Metric", 1), metrics.MeasureAsync("Metric", entity, 1),
                metrics.ObserveAsync("Metric", 1), metrics.ObserveAsync("Metric", entity, 1), metrics.IncrementCounterAsync("Metric", 1), metrics.IncrementCounterAsync("Metric", entity, 1)];
            Assert.All(calls, call => Assert.True(call.IsCompletedSuccessfully));
            usage.RecordDefinitionCacheHit(); usage.RecordDefinitionCacheMiss();
        }
        return new WeakReference(entity);
    }

    [Fact]
    public async Task Offline_usage_scope_and_use_complete_without_recording()
    {
        var usage = new NoOpUsageStatsProvider();
        await using (var scope = await usage.BeginUsageAsync("Feature"))
        {
            scope.Fail();
            scope.MarkCancelled();
        }

        await using (var scoped = await usage.BeginUsageAsync(new { Id = 1 }, "Feature"))
        {
            scoped.Dispose();
        }

        var ran = false;
        await usage.UseAsync("Feature", () =>
        {
            ran = true;
            return Task.CompletedTask;
        });
        Assert.True(ran);

        await usage.UseAsync("Feature", scope =>
        {
            scope.Fail();
            scope.MarkCancelled();
            return Task.CompletedTask;
        });
    }
}
