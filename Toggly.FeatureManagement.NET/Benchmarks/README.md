# Toggly Feature Management Benchmarks

This project contains performance benchmarks for the Toggly Feature Management .NET SDK using BenchmarkDotNet.

## Running Benchmarks

### Run All Benchmarks

```bash
dotnet run -c Release
```

### Run Specific Benchmark Classes

You can modify `Program.cs` to run specific benchmarks:

```csharp
BenchmarkRunner.Run<FeatureEvaluationBenchmarks>();
```

Or use command-line arguments:

```bash
dotnet run -c Release -- --filter "*FeatureEvaluationBenchmarks*"
```

## Benchmark Categories

### 1. FeatureEvaluationBenchmarks
Core feature flag evaluation performance:
- **SimpleFlagEvaluation**: Primary marketing metric - simple flag evaluation with no targeting
- **MultipleFlagsEvaluation**: Sequential evaluation of multiple flags (1, 5, 10, 50)
- **ParallelFlagsEvaluation**: Parallel evaluation of multiple flags
- **NonExistentFlagEvaluation**: Evaluation of a flag that doesn't exist
- **FirstEvaluationAfterInit**: First evaluation after flags are loaded
- **EvaluationWithManyFlags**: Performance with large caches (100, 500, 1000 flags)

### 2. TargetingRulesBenchmarks
Performance with different targeting scenarios:
- **PercentageRolloutEvaluation**: Flags with 0%, 50%, 100% rollouts
- **UserTargetingEvaluation**: Flags with user ID targeting
- **ComplexTargetingEvaluation**: Flags with multiple targeting rules
- **NoTargetingVsTargeting**: Comparison of simple vs targeted flags

### 3. UsageStatsBenchmarks
Impact of usage statistics tracking:
- **EvaluationWithStatsTracking**: Evaluation with stats enabled (default)
- **RecordCheckAsync**: Direct measurement of stats recording overhead
- **RecordUsageAsync**: Direct measurement of usage recording with context

### 4. MetricsBenchmarks
Performance of metrics operations:
- **MeasureAsync**: Recording metric values
- **IncrementCounterAsync**: Incrementing counters
- **ObserveAsync**: Recording observations
- **MetricsWithFeatureFlags**: Metrics that trigger feature flag evaluations

### 5. MemoryAllocationBenchmarks
Memory allocation analysis:
- **EvaluationMemoryAllocation**: Memory per simple evaluation
- **ContextEvaluationMemoryAllocation**: Memory for context-based evaluation
- **BulkEvaluationMemoryAllocation**: Memory for evaluating many flags

### 6. CachingBenchmarks
Cache performance:
- **CacheHitPerformance**: Evaluation when flag is in cache (typical production)
- **LargeCachePerformance**: Performance with large caches (100, 500, 1000 flags)

### 7. InitializationBenchmarks
SDK initialization performance:
- **ServiceCollectionSetup**: Time to configure DI container
- **ProviderInitialization**: Time to initialize provider and load flags
- **InitialFlagLoad**: Time to load flags from snapshot provider
- **FirstEvaluationAfterInit**: Time for first evaluation after initialization

## Results

Results are exported in multiple formats:
- **Markdown**: `BenchmarkDotNet.Artifacts/results/*.md`
- **CSV**: `BenchmarkDotNet.Artifacts/results/*.csv`
- **HTML**: `BenchmarkDotNet.Artifacts/results/*.html`

## Key Metrics

The benchmarks report:
- **Mean**: Average evaluation time
- **Median**: 50th percentile
- **P95**: 95th percentile (important for worst-case scenarios)
- **P99**: 99th percentile
- **Min/Max**: Best and worst case
- **Allocated Memory**: Memory per operation
- **Gen0/Gen1/Gen2 Collections**: GC pressure

## Marketing Metrics

The primary marketing metric is **SimpleFlagEvaluation**, which measures the typical evaluation time for a simple on/off flag when flags are already loaded (the common production scenario).

Expected results: Sub-millisecond evaluation times (< 1ms average).

