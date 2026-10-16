import 'package:feature_flags_toggly/src/services/system_metrics_collector.dart';
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
}
