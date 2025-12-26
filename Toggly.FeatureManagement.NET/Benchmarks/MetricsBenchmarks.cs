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
    [SimpleJob(RuntimeMoniker.Net90, warmupCount: 1, iterationCount: 15)]
    [MarkdownExporter]
    [RankColumn]
    public class MetricsBenchmarks
    {
        private IMetricsService _metricsService = null!;
        private IFeatureManager _featureManager = null!;
        private IServiceProvider _serviceProvider = null!;
        private const string MetricKey = "TestMetric";
        private const string FeatureKey = "SimpleFlag";

        [GlobalSetup]
        public async Task Setup()
        {
            var snapshotProvider = TestDataHelpers.CreateMockSnapshotProvider();
            _serviceProvider = TestDataHelpers.CreateServiceProvider(snapshotProvider);
            _featureManager = await TestDataHelpers.GetFeatureManagerAsync(_serviceProvider);
            _metricsService = _serviceProvider.GetRequiredService<IMetricsService>();
            
            // Warmup
            await _featureManager.IsEnabledAsync(FeatureKey);
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
        /// Recording a metric value
        /// </summary>
        [Benchmark]
        public async Task MeasureAsync()
        {
            await _metricsService.MeasureAsync(MetricKey, 42.0);
        }

        /// <summary>
        /// Recording a metric value with context
        /// </summary>
        [Benchmark]
        public async Task MeasureAsyncWithContext()
        {
            var context = new { UserId = "test-user" };
            await _metricsService.MeasureAsync(MetricKey, context, 42.0);
        }

        /// <summary>
        /// Incrementing a counter
        /// </summary>
        [Benchmark]
        public async Task IncrementCounterAsync()
        {
            await _metricsService.IncrementCounterAsync(MetricKey, 1.0);
        }

        /// <summary>
        /// Incrementing a counter with context
        /// </summary>
        [Benchmark]
        public async Task IncrementCounterAsyncWithContext()
        {
            var context = new { UserId = "test-user" };
            await _metricsService.IncrementCounterAsync(MetricKey, context, 1.0);
        }

        /// <summary>
        /// Recording an observation
        /// </summary>
        [Benchmark]
        public async Task ObserveAsync()
        {
            await _metricsService.ObserveAsync(MetricKey, 42.0);
        }

        /// <summary>
        /// Recording an observation with context
        /// </summary>
        [Benchmark]
        public async Task ObserveAsyncWithContext()
        {
            var context = new { UserId = "test-user" };
            await _metricsService.ObserveAsync(MetricKey, context, 42.0);
        }

        /// <summary>
        /// Metrics that trigger feature flag evaluations
        /// </summary>
        [Benchmark]
        public async Task MetricsWithFeatureFlags()
        {
            // This will trigger feature flag evaluation if the metric is associated with features
            await _metricsService.MeasureAsync(MetricKey, 42.0);
        }
    }
}

