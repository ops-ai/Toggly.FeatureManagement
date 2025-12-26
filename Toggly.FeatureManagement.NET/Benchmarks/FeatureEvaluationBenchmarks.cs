using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Jobs;
using Microsoft.FeatureManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Toggly.FeatureManagement;

namespace Toggly.FeatureManagement.Benchmarks
{
    [MemoryDiagnoser]
    [SimpleJob(RuntimeMoniker.Net90)]
    [MarkdownExporter]
    [RankColumn]
    [BaselineColumn]
    public class FeatureEvaluationBenchmarks
    {
        private IFeatureManager _featureManager = null!;
        private IServiceProvider _serviceProvider = null!;
        private readonly Dictionary<int, (IFeatureManager Manager, IServiceProvider ServiceProvider, string FlagName)> _manyFlagsManagers = new();
        private const string SimpleFlagName = "SimpleFlag";
        private readonly string[] _flagNames = { "Feature0", "Feature1", "Feature2", "Feature3", "Feature4" };
        private readonly string[] _manyFlagNames = new string[1000];

        [GlobalSetup]
        public async Task Setup()
        {
            var snapshotProvider = TestDataHelpers.CreateMockSnapshotProvider();
            _serviceProvider = TestDataHelpers.CreateServiceProvider(snapshotProvider);
            _featureManager = await TestDataHelpers.GetFeatureManagerAsync(_serviceProvider);
            
            // Warmup
            await _featureManager.IsEnabledAsync(SimpleFlagName);
            
            // Setup many flag names
            for (int i = 0; i < 1000; i++)
            {
                _manyFlagNames[i] = $"Feature{i}";
            }
            
            // Pre-initialize feature managers for different flag counts
            foreach (var flagCount in new[] { 100, 500, 1000 })
            {
                var manyFeatures = TestDataHelpers.CreateManyFeatureDefinitions(flagCount);
                var manySnapshotProvider = new MockSnapshotProvider(manyFeatures);
                var manyServiceProvider = TestDataHelpers.CreateServiceProvider(manySnapshotProvider);
                var manyFeatureManager = await TestDataHelpers.GetFeatureManagerAsync(manyServiceProvider);
                
                // Warmup
                await manyFeatureManager.IsEnabledAsync($"Feature{flagCount / 2}");
                
                _manyFlagsManagers[flagCount] = (manyFeatureManager, manyServiceProvider, $"Feature{flagCount / 2}");
            }
        }

        [GlobalCleanup]
        public void Cleanup()
        {
            if (_serviceProvider is IDisposable disposable)
            {
                disposable.Dispose();
            }
            
            foreach (var (_, serviceProvider, _) in _manyFlagsManagers.Values)
            {
                if (serviceProvider is IDisposable disp)
                {
                    disp.Dispose();
                }
            }
        }

        /// <summary>
        /// Primary marketing metric: Simple flag evaluation with no targeting
        /// </summary>
        [Benchmark(Baseline = true)]
        public async Task<bool> SimpleFlagEvaluation()
        {
            return await _featureManager.IsEnabledAsync(SimpleFlagName);
        }

        /// <summary>
        /// Evaluate multiple flags sequentially
        /// </summary>
        [Benchmark]
        [Arguments(1)]
        [Arguments(5)]
        [Arguments(10)]
        [Arguments(50)]
        public async Task<bool> MultipleFlagsEvaluation(int count)
        {
            bool result = false;
            for (int i = 0; i < count; i++)
            {
                result = await _featureManager.IsEnabledAsync(_flagNames[i % _flagNames.Length]);
            }
            return result;
        }

        /// <summary>
        /// Evaluate multiple flags in parallel
        /// </summary>
        [Benchmark]
        [Arguments(1)]
        [Arguments(5)]
        [Arguments(10)]
        [Arguments(50)]
        public async Task<bool> ParallelFlagsEvaluation(int count)
        {
            var tasks = new List<Task<bool>>();
            for (int i = 0; i < count; i++)
            {
                tasks.Add(_featureManager.IsEnabledAsync(_flagNames[i % _flagNames.Length]));
            }
            var results = await Task.WhenAll(tasks);
            return results.All(r => r);
        }

        /// <summary>
        /// Evaluate a flag that doesn't exist
        /// </summary>
        [Benchmark]
        public async Task<bool> NonExistentFlagEvaluation()
        {
            return await _featureManager.IsEnabledAsync("NonExistentFlag");
        }

        /// <summary>
        /// First evaluation after initialization (flags already loaded)
        /// </summary>
        [Benchmark]
        public async Task<bool> FirstEvaluationAfterInit()
        {
            // This simulates the first evaluation path after flags are loaded
            return await _featureManager.IsEnabledAsync(SimpleFlagName);
        }

        /// <summary>
        /// Performance with many flags in cache (evaluation only, no initialization)
        /// </summary>
        [Benchmark]
        [Arguments(100)]
        [Arguments(500)]
        [Arguments(1000)]
        public async Task<bool> EvaluationWithManyFlags(int flagCount)
        {
            // Use pre-initialized feature manager from GlobalSetup
            var (featureManager, _, flagName) = _manyFlagsManagers[flagCount];
            return await featureManager.IsEnabledAsync(flagName);
        }
    }
}

