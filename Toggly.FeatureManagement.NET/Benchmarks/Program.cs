using BenchmarkDotNet.Running;
using System;

namespace Toggly.FeatureManagement.Benchmarks
{
    class Program
    {
        static void Main(string[] args)
        {
            // Run all benchmarks
            var summary = BenchmarkRunner.Run(typeof(Program).Assembly);
            
            // Or run specific benchmarks:
            // BenchmarkRunner.Run<FeatureEvaluationBenchmarks>();
            // BenchmarkRunner.Run<TargetingRulesBenchmarks>();
            // BenchmarkRunner.Run<UsageStatsBenchmarks>();
            // BenchmarkRunner.Run<MetricsBenchmarks>();
            // BenchmarkRunner.Run<MemoryAllocationBenchmarks>();
            // BenchmarkRunner.Run<CachingBenchmarks>();
            // BenchmarkRunner.Run<InitializationBenchmarks>();
        }
    }
}

