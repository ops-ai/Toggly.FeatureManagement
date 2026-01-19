using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Jobs;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;
using System;
using System.Threading.Tasks;
using Toggly.FeatureManagement;

namespace Toggly.FeatureManagement.Benchmarks
{
    [MemoryDiagnoser]
    [SimpleJob(RuntimeMoniker.Net90)]
    [MarkdownExporter]
    [RankColumn]
    [BaselineColumn]
    public class UsageStatsBenchmarks
    {
        private IFeatureManager _featureManager = null!;
        private IFeatureUsageStatsProvider _usageStatsProvider = null!;
        private IServiceProvider _serviceProvider = null!;
        private const string SimpleFlagName = "SimpleFlag";

        [GlobalSetup]
        public async Task Setup()
        {
            var snapshotProvider = TestDataHelpers.CreateMockSnapshotProvider();
            _serviceProvider = TestDataHelpers.CreateServiceProvider(snapshotProvider);
            _featureManager = await TestDataHelpers.GetFeatureManagerAsync(_serviceProvider);
            _usageStatsProvider = _serviceProvider.GetRequiredService<IFeatureUsageStatsProvider>();
            
            // Warmup
            await _featureManager.IsEnabledAsync(SimpleFlagName);
        }

        [GlobalCleanup]
        public void Cleanup()
        {
            if (_serviceProvider is IDisposable disposable)
            {
                disposable.Dispose();
            }
        }

        /// <summary>
        /// Evaluation with stats tracking enabled (default behavior)
        /// </summary>
        [Benchmark(Baseline = true)]
        public async Task<bool> EvaluationWithStatsTracking()
        {
            return await _featureManager.IsEnabledAsync(SimpleFlagName);
        }

        /// <summary>
        /// Direct measurement of stats recording overhead
        /// </summary>
        [Benchmark]
        public async Task RecordCheckAsync()
        {
            await _usageStatsProvider.RecordCheckAsync(SimpleFlagName, true);
        }

        /// <summary>
        /// Direct measurement of usage recording with context
        /// </summary>
        [Benchmark]
        public async Task RecordUsageAsyncWithContext()
        {
            var context = new { UserId = "test-user" };
            await _usageStatsProvider.RecordUsageAsync(SimpleFlagName, context, true);
        }

        /// <summary>
        /// Direct measurement of usage recording without context
        /// </summary>
        [Benchmark]
        public async Task RecordUsageAsync()
        {
            await _usageStatsProvider.RecordUsageAsync(SimpleFlagName);
        }

        /// <summary>
        /// Direct measurement of view recording without context
        /// </summary>
        [Benchmark]
        public async Task RecordViewAsync()
        {
            await _usageStatsProvider.RecordViewAsync(SimpleFlagName);
        }

        /// <summary>
        /// Direct measurement of view recording with context
        /// </summary>
        [Benchmark]
        public async Task RecordViewAsyncWithContext()
        {
            var context = new { UserId = "test-user" };
            await _usageStatsProvider.RecordViewAsync(SimpleFlagName, context);
        }

        /// <summary>
        /// Typical funnel: Check → View → Use
        /// </summary>
        [Benchmark]
        public async Task TypicalUserFunnel()
        {
            // 1. Feature is checked (evaluation)
            await _usageStatsProvider.RecordCheckAsync(SimpleFlagName, true);
            // 2. Feature UI is viewed/rendered
            await _usageStatsProvider.RecordViewAsync(SimpleFlagName);
            // 3. User actually uses the feature
            await _usageStatsProvider.RecordUsageAsync(SimpleFlagName);
        }
    }
}

