using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Jobs;
using Microsoft.FeatureManagement;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Benchmarks
{
    [MemoryDiagnoser]
    [SimpleJob(RuntimeMoniker.Net90)]
    [MarkdownExporter]
    [RankColumn]
    [BaselineColumn]
    public class CachingBenchmarks
    {
        private IFeatureManager _featureManager = null!;
        private IServiceProvider _serviceProvider = null!;
        private readonly Dictionary<int, (IFeatureManager Manager, IServiceProvider ServiceProvider, string FlagName)> _largeCacheManagers = new();
        private const string SimpleFlagName = "SimpleFlag";

        [GlobalSetup]
        public async Task Setup()
        {
            var snapshotProvider = TestDataHelpers.CreateMockSnapshotProvider();
            _serviceProvider = TestDataHelpers.CreateServiceProvider(snapshotProvider);
            _featureManager = await TestDataHelpers.GetFeatureManagerAsync(_serviceProvider);
            
            // Warmup - ensure flag is in cache
            await _featureManager.IsEnabledAsync(SimpleFlagName);
            
            // Pre-initialize feature managers for different flag counts
            foreach (var flagCount in new[] { 100, 500, 1000 })
            {
                var manyFeatures = TestDataHelpers.CreateManyFeatureDefinitions(flagCount);
                var manySnapshotProvider = new MockSnapshotProvider(manyFeatures);
                var manyServiceProvider = TestDataHelpers.CreateServiceProvider(manySnapshotProvider);
                var manyFeatureManager = await TestDataHelpers.GetFeatureManagerAsync(manyServiceProvider);
                
                // Warmup
                await manyFeatureManager.IsEnabledAsync($"Feature{flagCount / 2}");
                
                _largeCacheManagers[flagCount] = (manyFeatureManager, manyServiceProvider, $"Feature{flagCount / 2}");
            }
        }

        [GlobalCleanup]
        public void Cleanup()
        {
            if (_serviceProvider is IDisposable disposable)
            {
                disposable.Dispose();
            }
            
            foreach (var (_, serviceProvider, _) in _largeCacheManagers.Values)
            {
                if (serviceProvider is IDisposable disp)
                {
                    disp.Dispose();
                }
            }
        }

        /// <summary>
        /// Evaluation when flag is in cache (typical production scenario)
        /// </summary>
        [Benchmark(Baseline = true)]
        public async Task<bool> CacheHitPerformance()
        {
            return await _featureManager.IsEnabledAsync(SimpleFlagName);
        }

        /// <summary>
        /// Performance with large number of cached flags (evaluation only, no initialization)
        /// </summary>
        [Benchmark]
        [Arguments(100)]
        [Arguments(500)]
        [Arguments(1000)]
        public async Task<bool> LargeCachePerformance(int flagCount)
        {
            // Use pre-initialized feature manager from GlobalSetup
            var (featureManager, _, flagName) = _largeCacheManagers[flagCount];
            return await featureManager.IsEnabledAsync(flagName);
        }
    }
}

