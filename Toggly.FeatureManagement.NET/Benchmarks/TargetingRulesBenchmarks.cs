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
    public class TargetingRulesBenchmarks
    {
        private IFeatureManager _featureManager = null!;
        private IServiceProvider _serviceProvider = null!;
        private const string PercentageFlagName = "PercentageFlag50";
        private const string UserTargetingFlagName = "UserTargetingFlag";

        [GlobalSetup]
        public async Task Setup()
        {
            var features = new List<FeatureDefinitionModel>
            {
                new FeatureDefinitionModel
                {
                    FeatureKey = "SimpleFlag",
                    Filters = new List<FeatureFilter>
                    {
                        new AlwaysOnFilter { Name = "AlwaysOn" }
                    },
                    RequirementType = RequirementType.Any
                },
                new FeatureDefinitionModel
                {
                    FeatureKey = PercentageFlagName,
                    Filters = new List<FeatureFilter>
                    {
                        new FeatureFilter
                        {
                            Name = "Percentage",
                            Parameters = new Dictionary<string, string> { { "Value", "50" } }
                        }
                    },
                    RequirementType = RequirementType.Any
                },
                new FeatureDefinitionModel
                {
                    FeatureKey = "PercentageFlag0",
                    Filters = new List<FeatureFilter>
                    {
                        new FeatureFilter
                        {
                            Name = "Percentage",
                            Parameters = new Dictionary<string, string> { { "Value", "0" } }
                        }
                    },
                    RequirementType = RequirementType.Any
                },
                new FeatureDefinitionModel
                {
                    FeatureKey = "PercentageFlag100",
                    Filters = new List<FeatureFilter>
                    {
                        new FeatureFilter
                        {
                            Name = "Percentage",
                            Parameters = new Dictionary<string, string> { { "Value", "100" } }
                        }
                    },
                    RequirementType = RequirementType.Any
                },
                new FeatureDefinitionModel
                {
                    FeatureKey = UserTargetingFlagName,
                    Filters = new List<FeatureFilter>
                    {
                        new FeatureFilter
                        {
                            Name = "Targeting",
                            Parameters = new Dictionary<string, string>
                            {
                                { "Users", "user1,user2,user3" }
                            }
                        }
                    },
                    RequirementType = RequirementType.Any
                },
                new FeatureDefinitionModel
                {
                    FeatureKey = "ComplexTargetingFlag",
                    Filters = new List<FeatureFilter>
                    {
                        new FeatureFilter
                        {
                            Name = "Percentage",
                            Parameters = new Dictionary<string, string> { { "Value", "50" } }
                        },
                        new FeatureFilter
                        {
                            Name = "Targeting",
                            Parameters = new Dictionary<string, string>
                            {
                                { "Users", "user1,user2,user3" }
                            }
                        }
                    },
                    RequirementType = RequirementType.Any
                }
            };

            var snapshotProvider = new MockSnapshotProvider(features);
            _serviceProvider = TestDataHelpers.CreateServiceProvider(snapshotProvider);
            _featureManager = await TestDataHelpers.GetFeatureManagerAsync(_serviceProvider);
            
            // Warmup
            await _featureManager.IsEnabledAsync("SimpleFlag");
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
        /// Flag with 0% rollout
        /// </summary>
        [Benchmark]
        public async Task<bool> PercentageRolloutEvaluation_0Percent()
        {
            return await _featureManager.IsEnabledAsync("PercentageFlag0");
        }

        /// <summary>
        /// Flag with 50% rollout
        /// </summary>
        [Benchmark]
        public async Task<bool> PercentageRolloutEvaluation_50Percent()
        {
            return await _featureManager.IsEnabledAsync(PercentageFlagName);
        }

        /// <summary>
        /// Flag with 100% rollout
        /// </summary>
        [Benchmark]
        public async Task<bool> PercentageRolloutEvaluation_100Percent()
        {
            return await _featureManager.IsEnabledAsync("PercentageFlag100");
        }

        /// <summary>
        /// Flag with user targeting
        /// </summary>
        [Benchmark]
        public async Task<bool> UserTargetingEvaluation()
        {
            return await _featureManager.IsEnabledAsync(UserTargetingFlagName);
        }

        /// <summary>
        /// Flag with complex multi-rule targeting
        /// </summary>
        [Benchmark]
        public async Task<bool> ComplexTargetingEvaluation()
        {
            return await _featureManager.IsEnabledAsync("ComplexTargetingFlag");
        }

        /// <summary>
        /// Compare simple flag vs flag with targeting rules
        /// </summary>
        [Benchmark(Baseline = true)]
        public async Task<bool> NoTargetingEvaluation()
        {
            return await _featureManager.IsEnabledAsync("SimpleFlag");
        }

        /// <summary>
        /// Flag with targeting rules
        /// </summary>
        [Benchmark]
        public async Task<bool> TargetingEvaluation()
        {
            return await _featureManager.IsEnabledAsync(PercentageFlagName);
        }
    }
}

