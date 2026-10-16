import 'dart:async';
import 'package:flutter/foundation.dart';

class SystemMetricSample {
  const SystemMetricSample(this.metric, this.value);
  final String metric;
  final double value;
}

/// Opt-in client metrics: [ExceptionCount] every 10s via gauges.
class SystemMetricsCollector {
  SystemMetricsCollector({
    required void Function(String metric, double value) observe,
    Duration interval = const Duration(seconds: 10),
    List<SystemMetricSample> Function()? sampler,
  })  : _observe = observe,
        _interval = interval,
        _sampler = sampler;

  static const int maxPending = 30;

  final void Function(String metric, double value) _observe;
  final Duration _interval;
  final List<SystemMetricSample> Function()? _sampler;
  final Map<String, int> _pendingByMetric = {};
  Timer? _timer;
  var _started = false;
  var _exceptionCount = 0;
  FlutterExceptionHandler? _previousFlutterHandler;
  bool Function(Object error, StackTrace stack)? _previousPlatformHandler;

  void start() {
    if (_started) return;
    _started = true;
    _attachExceptionHandlers();
    _timer = Timer.periodic(_interval, (_) => tick());
  }

  void stop() {
    if (!_started) return;
    _started = false;
    _timer?.cancel();
    _timer = null;
    _detachExceptionHandlers();
    _pendingByMetric.clear();
    _exceptionCount = 0;
  }

  void onFlushed() {
    _pendingByMetric.clear();
  }

  void tick() {
    if (!_started) return;
    try {
      final samples = _sampler?.call() ?? _defaultSample();
      for (final sample in samples) {
        if (!sample.value.isFinite) continue;
        final pending = _pendingByMetric[sample.metric] ?? 0;
        if (pending >= maxPending) continue;
        _pendingByMetric[sample.metric] = pending + 1;
        _observe(sample.metric, sample.value);
      }
    } catch (_) {
      // Never disrupt the host application.
    }
  }

  List<SystemMetricSample> _defaultSample() {
    final out = <SystemMetricSample>[];
    if (_exceptionCount > 0) {
      out.add(SystemMetricSample('ExceptionCount', _exceptionCount.toDouble()));
      _exceptionCount = 0;
    }
    return out;
  }

  void _attachExceptionHandlers() {
    _previousFlutterHandler = FlutterError.onError;
    FlutterError.onError = (details) {
      _exceptionCount++;
      _previousFlutterHandler?.call(details);
    };
    _previousPlatformHandler = PlatformDispatcher.instance.onError;
    PlatformDispatcher.instance.onError = (error, stack) {
      _exceptionCount++;
      final handled = _previousPlatformHandler?.call(error, stack) ?? false;
      return handled;
    };
  }

  void _detachExceptionHandlers() {
    if (_previousFlutterHandler != null) {
      FlutterError.onError = _previousFlutterHandler;
      _previousFlutterHandler = null;
    }
    if (_previousPlatformHandler != null) {
      PlatformDispatcher.instance.onError = _previousPlatformHandler;
      _previousPlatformHandler = null;
    }
  }
}
