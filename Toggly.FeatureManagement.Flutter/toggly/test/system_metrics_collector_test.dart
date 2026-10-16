import 'package:fake_async/fake_async.dart';
import 'package:feature_flags_toggly/src/services/system_metrics_collector.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('emits injected exception count', () {
    final observed = <SystemMetricSample>[];
    final collector = SystemMetricsCollector(
      observe: (metric, value) =>
          observed.add(SystemMetricSample(metric, value)),
      sampler: () => [const SystemMetricSample('ExceptionCount', 2)],
    );
    collector.start();
    collector.tick();
    collector.stop();
    expect(observed.length, 1);
    expect(observed.first.metric, 'ExceptionCount');
    expect(observed.first.value, 2);
  });

  test('does not emit until exceptions accumulate', () {
    final observed = <SystemMetricSample>[];
    final collector = SystemMetricsCollector(
      observe: (metric, value) =>
          observed.add(SystemMetricSample(metric, value)),
    );
    collector.start();
    collector.tick();
    expect(observed, isEmpty);
    collector.stop();
  });

  test('emits ExceptionCount and clears the window', () {
    final observed = <SystemMetricSample>[];
    final collector = SystemMetricsCollector(
      observe: (metric, value) =>
          observed.add(SystemMetricSample(metric, value)),
    );
    collector.start();
    FlutterError.onError!(
      FlutterErrorDetails(exception: Exception('one'), library: 'test'),
    );
    FlutterError.onError!(
      FlutterErrorDetails(exception: Exception('two'), library: 'test'),
    );
    collector.tick();
    expect(observed, hasLength(1));
    expect(observed.single.metric, 'ExceptionCount');
    expect(observed.single.value, 2);
    collector.tick();
    expect(observed, hasLength(1));
    collector.stop();
  });

  test('caps pending samples per metric', () {
    final metrics = <String>[];
    final collector = SystemMetricsCollector(
      observe: (metric, _) => metrics.add(metric),
      sampler: () => [const SystemMetricSample('ExceptionCount', 1)],
    );
    collector.start();
    for (var i = 0; i < SystemMetricsCollector.maxPending + 3; i++) {
      collector.tick();
    }
    expect(metrics, hasLength(SystemMetricsCollector.maxPending));
    collector.onFlushed();
    collector.tick();
    expect(metrics, hasLength(SystemMetricsCollector.maxPending + 1));
    collector.stop();
  });

  test('ignores non-finite sampler values', () {
    final observed = <SystemMetricSample>[];
    final collector = SystemMetricsCollector(
      observe: (metric, value) =>
          observed.add(SystemMetricSample(metric, value)),
      sampler: () => [
        const SystemMetricSample('Finite', 1),
        const SystemMetricSample('NaN', double.nan),
        const SystemMetricSample('Infinite', double.infinity),
      ],
    );
    collector.start();
    collector.tick();
    expect(observed, hasLength(1));
    expect(observed.single.metric, 'Finite');
    expect(observed.single.value, 1);
    collector.stop();
  });

  test('tick is a no-op before start and after stop', () {
    final observed = <SystemMetricSample>[];
    final collector = SystemMetricsCollector(
      observe: (metric, value) =>
          observed.add(SystemMetricSample(metric, value)),
      sampler: () => [const SystemMetricSample('ExceptionCount', 1)],
    );
    collector.tick();
    collector.start();
    collector.stop();
    collector.tick();
    expect(observed, isEmpty);
  });

  test('start is idempotent and stop clears pending state', () {
    final observed = <SystemMetricSample>[];
    final collector = SystemMetricsCollector(
      observe: (metric, value) =>
          observed.add(SystemMetricSample(metric, value)),
      sampler: () => [const SystemMetricSample('ExceptionCount', 1)],
    );
    collector.start();
    collector.start();
    collector.tick();
    collector.stop();
    collector.stop();
    collector.start();
    for (var i = 0; i < SystemMetricsCollector.maxPending; i++) {
      collector.tick();
    }
    collector.stop();
    collector.start();
    collector.tick();
    expect(observed, hasLength(32));
    collector.stop();
  });

  test('sampler failures do not escape tick', () {
    final collector = SystemMetricsCollector(
      observe: (_, __) {},
      sampler: () => throw StateError('boom'),
    );
    collector.start();
    expect(() => collector.tick(), returnsNormally);
    collector.stop();
  });

  test('periodic timer invokes tick', () {
    fakeAsync((async) {
      final observed = <SystemMetricSample>[];
      final collector = SystemMetricsCollector(
        observe: (metric, value) =>
            observed.add(SystemMetricSample(metric, value)),
        interval: const Duration(seconds: 10),
        sampler: () => [const SystemMetricSample('Heartbeat', 1)],
      );
      collector.start();
      expect(observed, isEmpty);
      async.elapse(const Duration(seconds: 10));
      expect(observed, hasLength(1));
      expect(observed.single.metric, 'Heartbeat');
      expect(observed.single.value, 1);
      collector.stop();
    });
  });

  group('exception sources', () {
    test('chains FlutterError handler', () {
      var previousCalled = false;
      final previous = FlutterError.onError;
      FlutterError.onError = (_) => previousCalled = true;

      final collector = SystemMetricsCollector(observe: (_, __) {});
      collector.start();
      FlutterError.onError!(
        FlutterErrorDetails(exception: Exception('boom'), library: 'test'),
      );
      expect(previousCalled, isTrue);

      collector.stop();
      FlutterError.onError = previous;
    });

    test('chains PlatformDispatcher.onError and preserves handled flag', () {
      var previousCalled = false;
      final previous = PlatformDispatcher.instance.onError;
      PlatformDispatcher.instance.onError = (error, stack) {
        previousCalled = true;
        return true;
      };

      final collector = SystemMetricsCollector(observe: (_, __) {});
      collector.start();
      final handled = PlatformDispatcher.instance.onError!(
        Exception('boom'),
        StackTrace.current,
      );
      expect(previousCalled, isTrue);
      expect(handled, isTrue);

      collector.stop();
      PlatformDispatcher.instance.onError = previous;
    });

    test('counts Flutter and platform exceptions together', () {
      final observed = <SystemMetricSample>[];
      final collector = SystemMetricsCollector(
        observe: (metric, value) =>
            observed.add(SystemMetricSample(metric, value)),
      );
      collector.start();
      FlutterError.onError!(
        FlutterErrorDetails(exception: Exception('flutter'), library: 'test'),
      );
      PlatformDispatcher.instance.onError!(
        Exception('platform'),
        StackTrace.current,
      );
      collector.tick();
      expect(observed, hasLength(1));
      expect(observed.single.metric, 'ExceptionCount');
      expect(observed.single.value, 2);
      collector.stop();
    });
  });
}
