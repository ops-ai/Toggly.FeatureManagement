import 'package:benchmark_harness/benchmark_harness.dart';
import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'dart:developer' as developer;

class DetailedTogglyBenchmark extends BenchmarkBase {
  final bool useApi;
  final int warmupRuns;
  final int measureRuns;
  static const String _testFlag = 'test-feature';

  List<int> _measurements = [];

  DetailedTogglyBenchmark({
    this.useApi = false,
    this.warmupRuns = 10,
    this.measureRuns = 100,
  }) : super(useApi ? 'Toggly API Evaluation' : 'Toggly Cache Evaluation');

  Future<void> setupAsync() async {
    // Ensure clean state and wait for any pending operations
    try {
      Toggly.dispose();
    } catch (e) {
      // Ignore dispose errors
    }
    await Future.delayed(Duration(milliseconds: 500));

    if (useApi) {
      await Toggly.init(
        appKey: 'your-api-key',
        environment: 'benchmark',
      );
    } else {
      await Toggly.init(
        flagDefaults: {_testFlag: true},
      );
    }

    // Wait for initialization to complete
    await Future.delayed(Duration(milliseconds: 500));

    // Warmup runs
    developer.log('Starting warmup...');
    for (var i = 0; i < warmupRuns; i++) {
      await Toggly.evaluateFeatureGate([_testFlag]);
      await Future.delayed(Duration(milliseconds: 10));
    }
    developer.log('Warmup complete');

    // Wait after warmup
    await Future.delayed(Duration(milliseconds: 500));
  }

  Future<void> runAsync() async {
    final stopwatch = Stopwatch()..start();

    for (var i = 0; i < measureRuns; i++) {
      stopwatch.reset();
      await Toggly.evaluateFeatureGate([_testFlag]);
      _measurements.add(stopwatch.elapsedMicroseconds);
      await Future.delayed(Duration(milliseconds: 10));
    }
  }

  @override
  void setup() {} // Required by BenchmarkBase

  @override
  void run() {} // Required by BenchmarkBase

  Future<void> teardown() async {
    // Calculate statistics
    _measurements.sort();
    final avg = _measurements.reduce((a, b) => a + b) / _measurements.length;
    final median = _measurements[_measurements.length ~/ 2];
    final p95 = _measurements[(_measurements.length * 0.95).floor()];

    developer.log('''
Benchmark Results:
  Average: ${avg.toStringAsFixed(2)}µs
  Median: ${median}µs
  P95: ${p95}µs
  Min: ${_measurements.first}µs
  Max: ${_measurements.last}µs
''');

    try {
      Toggly.dispose();
    } catch (e) {
      // Ignore dispose errors
    }
    await Future.delayed(Duration(milliseconds: 500));
  }

  Future<void> reportAsync() async {
    await setupAsync();
    await runAsync();
    await teardown();
  }
}

void main() async {
  // Initialize Flutter bindings
  WidgetsFlutterBinding.ensureInitialized();

  // Run cached evaluation benchmark
  await DetailedTogglyBenchmark(
    useApi: false,
    warmupRuns: 20,
    measureRuns: 1000,
  ).reportAsync();

  // Add significant delay between benchmarks
  await Future.delayed(Duration(seconds: 2));

  // Run API evaluation benchmark
  await DetailedTogglyBenchmark(
    useApi: true,
    warmupRuns: 20,
    measureRuns: 1000,
  ).reportAsync();

  // Exit the program
  print('Benchmarks complete');
}
