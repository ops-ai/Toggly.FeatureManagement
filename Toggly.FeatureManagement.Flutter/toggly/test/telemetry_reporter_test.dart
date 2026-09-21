import 'dart:convert';
import 'dart:io';
import 'dart:async';

import 'package:dio/dio.dart';
import 'package:feature_flags_toggly/src/services/telemetry_reporter.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('shared context transitions preserve seven immutable envelopes',
      () async {
    final contract = jsonDecode(
        File('../../tests/frontend-telemetry/contract.json')
            .readAsStringSync());
    for (final scenario in contract['contextTransitionScenarios']) {
      final sent = <dynamic>[];
      final dio = Dio()
        ..interceptors.add(InterceptorsWrapper(onRequest: (r, h) {
          sent.add(jsonDecode(
              r.data is String ? r.data : utf8.decode(gzip.decode(r.data))));
          h.resolve(Response(requestOptions: r, statusCode: 202));
        }));
      final reporter = TelemetryReporter(
          appKey: scenario['options']['appKey'], httpClient: dio);
      for (final event in scenario['events']) {
        switch (event[0]) {
          case 'setContext':
            reporter.setContext(
                identity: event[1]['identity'],
                instanceId: event[1]['instanceId']);
            break;
          case 'incrementCounter':
            reporter.incrementCounter(event[1], event[2]);
            break;
          case 'setGauge':
            reporter.setGauge(event[1], event[2]);
            break;
          case 'recordUsage':
            reporter.recordUsage(event[1]);
            break;
          case 'recordView':
            reporter.recordView(event[1]);
            break;
        }
      }
      await reporter.flushTelemetry();
      expect(sent, scenario['envelopes']);
      reporter.dispose();
    }
  });

  test(
      'captured checks stay with their owner across reentrant identity changes',
      () async {
    final sent = <dynamic>[];
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (r, h) {
        sent.add(jsonDecode(
            r.data is String ? r.data : utf8.decode(gzip.decode(r.data))));
        h.resolve(Response(requestOptions: r, statusCode: 202));
      }));
    final reporter =
        TelemetryReporter(appKey: 'key', identity: 'alice', httpClient: dio);
    final captured = reporter.captureContext();
    reporter.setContext(identity: 'bob');
    reporter.incrementCounter('new');
    reporter.recordCapturedCheck(captured, 'old', 'enabled');
    final other = TelemetryReporter(appKey: 'other', httpClient: dio);
    other.recordCapturedCheck(captured, 'wrong', 'enabled');
    await reporter.flushTelemetry();
    await other.flushTelemetry();
    expect(sent.where((b) => b['u'] == 'alice').single['f'], {
      'old': {
        'enabled': [1]
      }
    });
    expect(sent.where((b) => b['u'] == 'bob').single['m'], {'new': 1});
    expect(sent.every((b) => b['k'] == 'key'), true);
    reporter.dispose();
    other.dispose();
  });

  test('rotations share metadata-inclusive retention and entry limits',
      () async {
    final sent = <dynamic>[];
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (r, h) {
        sent.add(jsonDecode(
            r.data is String ? r.data : utf8.decode(gzip.decode(r.data))));
        h.resolve(Response(requestOptions: r, statusCode: 202));
      }));
    final reporter = TelemetryReporter(appKey: 'key', httpClient: dio);
    for (var i = 0; i < 2200; i++) {
      reporter.setContext(instanceId: 'token-$i-${'x' * 120}');
      reporter.incrementCounter('orders');
    }
    await reporter.flushTelemetry();
    expect(sent.length, lessThanOrEqualTo(2000));
    expect(sent.length, greaterThan(100));
    expect(sent.fold<int>(0, (a, b) => a + utf8.encode(jsonEncode(b)).length),
        lessThanOrEqualTo(262144));
    expect(sent.every((b) => utf8.encode(jsonEncode(b)).length <= 49152), true);
    reporter.setContext(instanceId: 'x' * 49152);
    reporter.incrementCounter('too-large');
    final previous = sent.length;
    await reporter.flushTelemetry();
    expect(sent.length, previous);
    reporter.dispose();
  });

  test('rotation during retry keeps bytes and permits immediate new events',
      () async {
    final sent = <String>[];
    final waiting = Completer<void>();
    final resume = Completer<void>();
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (r, h) {
        sent.add(r.data is String ? r.data : utf8.decode(gzip.decode(r.data)));
        h.resolve(Response(
            requestOptions: r, statusCode: sent.length == 1 ? 429 : 202));
      }));
    final reporter = TelemetryReporter(
        appKey: 'key',
        identity: 'alice',
        httpClient: dio,
        delay: (d) {
          expect(d, const Duration(seconds: 30));
          waiting.complete();
          return resume.future;
        });
    reporter.setGauge('cart', 1);
    final sending = reporter.flushTelemetry();
    await waiting.future;
    reporter.setContext(instanceId: 'token-b');
    reporter.setGauge('cart', 2);
    reporter.setContext(identity: 'bob');
    reporter.setGauge('cart', 3);
    resume.complete();
    await sending;
    expect(sent, hasLength(4));
    expect(sent[0], sent[1]);
    expect(jsonDecode(sent[2]), {
      'k': 'key',
      'e': 'Production',
      'i': 'token-b',
      'm': {'cart': 2}
    });
    expect(jsonDecode(sent[3]), {
      'k': 'key',
      'e': 'Production',
      'u': 'bob',
      'm': {'cart': 3}
    });
    reporter.dispose();
  });

  test('matches every shared endpoint scenario', () async {
    final contract = jsonDecode(
        File('../../tests/frontend-telemetry/contract.json')
            .readAsStringSync()) as Map<String, dynamic>;
    for (final raw in contract['endpointScenarios'] as List<dynamic>) {
      final scenario = raw as Map<String, dynamic>;
      final requests = <String>[];
      final diagnostics = <String>[];
      final dio = Dio()
        ..interceptors.add(InterceptorsWrapper(onRequest: (request, handler) {
          requests.add(request.uri.toString());
          handler.resolve(Response(requestOptions: request, statusCode: 202));
        }));
      final reporter = TelemetryReporter(
        appKey:
            (contract['options'] as Map<String, dynamic>)['appKey'] as String,
        metricsBaseUrl: scenario['metricsBaseUrl'] as String,
        httpClient: dio,
        onDiagnostic: diagnostics.add,
      );
      reporter.recordUsage('flag');
      await reporter.flushTelemetry();
      final expected = scenario['expectedUrl'] as String?;
      expect(requests, expected == null ? isEmpty : [expected],
          reason: scenario['name'] as String);
      expect(diagnostics, expected == null ? ['invalid_endpoint'] : isEmpty,
          reason: scenario['name'] as String);
      reporter.dispose();
    }
  });

  test('empty HTTP authority disables telemetry without scheduling work',
      () async {
    for (final base in ['https:///base', 'http:///base', 'https://']) {
      final diagnostics = <String>[];
      var requests = 0;
      final dio = Dio()
        ..interceptors.add(InterceptorsWrapper(onRequest: (request, handler) {
          requests++;
          handler.resolve(Response(requestOptions: request, statusCode: 202));
        }));
      late TelemetryReporter reporter;
      var scheduled = 0;
      runZoned(() {
        reporter = TelemetryReporter(
          appKey: 'key',
          metricsBaseUrl: base,
          httpClient: dio,
          onDiagnostic: diagnostics.add,
        );
      }, zoneSpecification: ZoneSpecification(
          createTimer: (self, parent, zone, duration, callback) {
        scheduled++;
        return parent.createTimer(zone, duration, callback);
      }));
      expect(scheduled, 0, reason: base);
      reporter.recordCheck('flag', 'enabled');
      await reporter.flushTelemetry();
      expect(requests, 0, reason: base);
      expect(diagnostics, ['invalid_endpoint'], reason: base);
      reporter.dispose();
    }
  });

  test('matches the shared frontend telemetry contract scenarios', () async {
    final contract = jsonDecode(
        File('../../tests/frontend-telemetry/contract.json')
            .readAsStringSync()) as Map<String, dynamic>;
    for (final scenario in contract['scenarios'] as List<dynamic>) {
      final fixture = scenario as Map<String, dynamic>;
      final options = <String, dynamic>{
        ...contract['options'] as Map<String, dynamic>,
        ...?fixture['options'] as Map<String, dynamic>?,
      };
      final sent = <Map<String, dynamic>>[];
      final dio = Dio()
        ..interceptors.add(InterceptorsWrapper(onRequest: (request, handler) {
          final data = request.data;
          final body = jsonDecode(
              data is String ? data : utf8.decode(gzip.decode(data)));
          sent.add(Map<String, dynamic>.from(body));
          handler.resolve(Response(requestOptions: request, statusCode: 202));
        }));
      final reporter = TelemetryReporter(
        appKey: options['appKey'] as String?,
        environment: options['environment'] as String,
        enableTelemetry: options['enableTelemetry'] as bool? ?? true,
        identity: options['identity'] as String?,
        instanceId: options['instanceId'] as String?,
        httpClient: dio,
      );
      for (final raw in fixture['events'] as List<dynamic>) {
        final event = raw as List<dynamic>;
        final name = event[0] as String;
        final key = event[1] as String;
        switch (name) {
          case 'recordCheck':
            reporter.recordCheck(key, event[2] as String);
            break;
          case 'recordUsage':
            reporter.recordUsage(
                key, event.length > 2 ? event[2] as String : 'enabled');
            break;
          case 'recordView':
            reporter.recordView(
                key, event.length > 2 ? event[2] as String : 'enabled');
            break;
          case 'incrementCounter':
            // Dart's typed public method rejects a fractional argument before
            // it can reach the reporter.
            if (event[2] is int) {
              reporter.incrementCounter(key, event[2] as int);
            }
            break;
          case 'setGauge':
            reporter.setGauge(key, event[2] as num);
            break;
        }
      }
      await reporter.flushTelemetry();
      expect(sent, fixture['envelopes'], reason: fixture['name'] as String);
      reporter.dispose();
    }
  });

  test('matches shared transport retry and failure scenarios', () async {
    final contract = jsonDecode(
        File('../../tests/frontend-telemetry/contract.json')
            .readAsStringSync()) as Map<String, dynamic>;
    for (final raw in contract['transportScenarios'] as List<dynamic>) {
      final scenario = raw as Map<String, dynamic>;
      final name = scenario['name'] as String;
      final origin = DateTime.utc(2026, 9, 18);
      var now = origin;
      var responses = 0;
      final attempts = <int>[];
      final dio = Dio()
        ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
          attempts.add(now.difference(origin).inMilliseconds);
          if (scenario['failure'] == 'timeout') return;
          if (scenario['failure'] == 'network') {
            handler.reject(DioException(
                requestOptions: options,
                type: DioExceptionType.connectionError));
            return;
          }
          final statuses = scenario['statuses'] as List<dynamic>;
          final status = statuses[responses++] as int;
          handler.resolve(Response(
            requestOptions: options,
            statusCode: status,
            headers: Headers.fromMap({
              if (scenario['retryAfter'] != null)
                'retry-after': [scenario['retryAfter'] as String]
            }),
          ));
        }));
      final reporter = TelemetryReporter(
        appKey: 'key',
        httpClient: dio,
        clock: () => now,
        delay: (duration) async => now = now.add(duration),
        requestTimeout: const Duration(milliseconds: 1),
      );
      reporter.incrementCounter('orders');
      await reporter.flushTelemetry();
      expect(attempts, scenario['attemptTimesMs'], reason: name);
      reporter.dispose();
    }
  });

  test('serializes only application, environment, feature and metric data',
      () async {
    final requests = <RequestOptions>[];
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        requests.add(options);
        handler.resolve(Response(requestOptions: options, statusCode: 202));
      }));
    final reporter = TelemetryReporter(
      appKey: 'app-key',
      environment: 'Staging',
      metricsBaseUrl: 'https://metrics.example/proxy/',
      httpClient: dio,
    );

    reporter.recordCheck('checkout', 'blue');
    reporter.recordCheck('checkout', 'blue');
    reporter.recordUsage('checkout', 'blue');
    reporter.recordView('checkout', 'blue');
    reporter.incrementCounter('orders', 3);
    reporter.setGauge('queue', 4.5);
    await reporter.flushTelemetry();

    expect(requests, hasLength(1));
    expect(requests.single.uri.toString(),
        'https://metrics.example/proxy/api/frontend/telemetry');
    final body = jsonDecode(utf8.decode(gzip.decode(requests.single.data)));
    expect(body, {
      'k': 'app-key',
      'e': 'Staging',
      'f': {
        'checkout': {
          'blue': [2, 1, 1]
        }
      },
      'm': {'orders': 3, 'queue': 4.5},
    });
    reporter.dispose();
  });

  test('disabled or keyless reporters never send requests', () async {
    var requests = 0;
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        requests++;
        handler.resolve(Response(requestOptions: options, statusCode: 202));
      }));
    for (final reporter in [
      TelemetryReporter(appKey: null, httpClient: dio),
      TelemetryReporter(appKey: 'key', enableTelemetry: false, httpClient: dio),
    ]) {
      reporter.recordCheck('flag', 'enabled');
      reporter.incrementCounter('metric');
      await reporter.flushTelemetry();
      reporter.dispose();
    }
    expect(requests, 0);
  });

  test('retries only explicit 503 and obeys longer Retry-After', () async {
    final waits = <Duration>[];
    var attempts = 0;
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        attempts++;
        handler.resolve(Response(
          requestOptions: options,
          statusCode: attempts == 1 ? 503 : 202,
          headers: Headers.fromMap({
            'retry-after': ['45']
          }),
        ));
      }));
    final reporter = TelemetryReporter(
      appKey: 'key',
      httpClient: dio,
      delay: (wait) async => waits.add(wait),
    );
    reporter.recordCheck('flag', 'enabled');
    await reporter.flushTelemetry();
    expect(attempts, 2);
    expect(waits, [const Duration(seconds: 45)]);
    reporter.dispose();
  });

  test('splits large counter deltas without losing accepted values', () async {
    final values = <num>[];
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        final data = options.data;
        final body =
            jsonDecode(data is String ? data : utf8.decode(gzip.decode(data)));
        values.add(body['m']['orders'] as num);
        handler.resolve(Response(requestOptions: options, statusCode: 202));
      }));
    final reporter = TelemetryReporter(appKey: 'key', httpClient: dio);
    reporter.incrementCounter('orders', 1000000);
    reporter.incrementCounter('orders', 1);
    await reporter.flushTelemetry();
    expect(values, [1000000, 1]);
    reporter.dispose();
  });

  test('repeated escaped keys stay inside the retained byte budget', () async {
    final diagnostics = <String>[];
    final requests = <Map<String, dynamic>>[];
    var retainedBytes = 0;
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        final data = options.data;
        final body = Map<String, dynamic>.from(
            jsonDecode(data is String ? data : utf8.decode(gzip.decode(data))));
        requests.add(body);
        retainedBytes += utf8.encode(jsonEncode(body)).length;
        handler.resolve(Response(requestOptions: options, statusCode: 202));
      }));
    final reporter = TelemetryReporter(
        appKey: 'key', httpClient: dio, onDiagnostic: diagnostics.add);
    final escapedKey = '"' * 19000;
    for (var i = 0; i < 10; i++) {
      reporter.incrementCounter(escapedKey, 1000000);
    }
    reporter.incrementCounter('unrelated');
    await reporter.flushTelemetry();

    expect(retainedBytes, lessThanOrEqualTo(262144));
    expect(requests.expand((body) => (body['m'] as Map).keys),
        contains('unrelated'));
    expect(diagnostics, contains('buffer_full'));
    expect(
        requests.fold<num>(
            0,
            (sum, body) =>
                sum + ((body['m'] as Map<String, dynamic>)[escapedKey] ?? 0)),
        greaterThan(0));
    reporter.dispose();
  });

  test('packet overflow and oversized entry preserve unrelated events',
      () async {
    final sent = <Map<String, dynamic>>[];
    final diagnostics = <String>[];
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        final data = options.data;
        sent.add(Map<String, dynamic>.from(jsonDecode(
            data is String ? data : utf8.decode(gzip.decode(data)))));
        handler.resolve(Response(requestOptions: options, statusCode: 202));
      }));
    final reporter = TelemetryReporter(
        appKey: 'key', httpClient: dio, onDiagnostic: diagnostics.add);
    final largeKey = 'x' * 49080;
    reporter.recordCheck(largeKey, 'enabled');
    reporter.incrementCounter('unrelated');
    reporter.recordCheck('x' * 50000, 'enabled');
    await reporter.flushTelemetry();

    expect(sent.length, 2);
    expect((sent.first['f'] as Map).keys, contains(largeKey));
    expect(sent.last['m'], {'unrelated': 1});
    expect(diagnostics, contains('buffer_full'));
    for (final envelope in sent) {
      expect(
          utf8.encode(jsonEncode(envelope)).length, lessThanOrEqualTo(49152));
    }
    reporter.dispose();
  });

  test('new variant rolls back exactly when packet reaches byte limit',
      () async {
    final sent = <Map<String, dynamic>>[];
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (request, handler) {
        sent.add(Map<String, dynamic>.from(jsonDecode(request.data as String)));
        handler.resolve(Response(requestOptions: request, statusCode: 202));
      }));
    final reporter = TelemetryReporter(
        appKey: 'key', httpClient: dio, compressor: (_) => null);
    reporter.recordCheck('f', 'a');
    reporter.incrementCounter('x' * 49030);
    reporter.recordCheck('f', 'b' * 64);
    await reporter.flushTelemetry();

    expect(sent.length, 2);
    expect((sent.first['f'] as Map)['f'], {
      'a': [1]
    });
    expect((sent.last['f'] as Map)['f'], {
      'b' * 64: [1]
    });
    for (final body in sent) {
      expect(utf8.encode(jsonEncode(body)).length, lessThanOrEqualTo(49152));
      for (final variants in (body['f'] as Map? ?? {}).values) {
        for (final counts in (variants as Map).values) {
          expect(counts, isNotEmpty);
        }
      }
    }
    reporter.dispose();
  });

  test('repeated checks aggregate without exhausting the entry limit',
      () async {
    final counts = <int>[];
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        final data = options.data;
        final body =
            jsonDecode(data is String ? data : utf8.decode(gzip.decode(data)));
        counts.add(body['f']['flag']['enabled'][0] as int);
        handler.resolve(Response(requestOptions: options, statusCode: 202));
      }));
    final reporter = TelemetryReporter(appKey: 'key', httpClient: dio);
    for (var i = 0; i < 2001; i++) {
      reporter.recordCheck('flag', 'enabled');
    }
    await reporter.flushTelemetry();
    expect(counts, [2001]);
    reporter.dispose();
  });

  test('invalid variant names do not contaminate valid buffered checks',
      () async {
    final diagnostics = <String>[];
    final sent = <Map<String, dynamic>>[];
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        final data = options.data;
        sent.add(Map<String, dynamic>.from(jsonDecode(
            data is String ? data : utf8.decode(gzip.decode(data)))));
        handler.resolve(Response(requestOptions: options, statusCode: 202));
      }));
    final reporter = TelemetryReporter(
        appKey: 'key', httpClient: dio, onDiagnostic: diagnostics.add);
    reporter.recordCheck('flag', 'blue_2-A');
    reporter.recordUsage('flag', 'bad space');
    reporter.recordView('flag', 'é');
    reporter.recordCheck('flag', 'a' * 65);
    reporter.recordCheck('flag', 'enabled\n');
    await reporter.flushTelemetry();
    expect(sent.single['f'], {
      'flag': {
        'blue_2-A': [1]
      }
    });
    expect(diagnostics, [
      'invalid_variant',
      'invalid_variant',
      'invalid_variant',
      'invalid_variant'
    ]);
    reporter.dispose();
  });

  test('invalid telemetry settings cannot interrupt flag evaluation', () async {
    final diagnostics = <String>[];
    var requests = 0;
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        requests++;
        handler.resolve(Response(requestOptions: options, statusCode: 202));
      }));
    final badUrl = TelemetryReporter(
      appKey: 'key',
      metricsBaseUrl: 'not-a-url',
      onDiagnostic: diagnostics.add,
      httpClient: dio,
    );
    badUrl.recordCheck('flag', 'enabled');
    await badUrl.flushTelemetry();
    final badInterval = TelemetryReporter(
      appKey: 'key',
      telemetryFlushIntervalMs: 1,
      onDiagnostic: diagnostics.add,
      httpClient: dio,
    );
    badInterval.recordCheck('flag', 'enabled');
    await badInterval.flushTelemetry();
    expect(requests, 1);
    expect(diagnostics, containsAll(['invalid_endpoint', 'invalid_interval']));
    badUrl.dispose();
    badInterval.dispose();
  });

  test('compression failure falls back before sending a plain JSON request',
      () async {
    final payloads = <Object?>[];
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        payloads.add(options.data);
        handler.resolve(Response(requestOptions: options, statusCode: 202));
      }));
    final reporter = TelemetryReporter(
      appKey: 'key',
      httpClient: dio,
      compressor: (_) => throw StateError('compressor unavailable'),
    );
    reporter.recordCheck('flag', 'enabled');
    await reporter.flushTelemetry();
    expect(payloads, hasLength(1));
    expect(jsonDecode(payloads.single as String)['f'], {
      'flag': {
        'enabled': [1]
      }
    });
    reporter.dispose();
  });

  test('held request keeps a newer gauge behind the older snapshot', () async {
    final first = Completer<void>();
    final started = Completer<void>();
    final values = <num>[];
    final dio = Dio()
      ..interceptors
          .add(InterceptorsWrapper(onRequest: (options, handler) async {
        final data = options.data;
        final body =
            jsonDecode(data is String ? data : utf8.decode(gzip.decode(data)));
        values.add(body['m']['queue'] as num);
        if (values.length == 1) {
          started.complete();
          await first.future;
        }
        handler.resolve(Response(requestOptions: options, statusCode: 202));
      }));
    final reporter = TelemetryReporter(appKey: 'key', httpClient: dio);
    reporter.setGauge('queue', 1);
    final oldFlush = reporter.flushTelemetry();
    await started.future;
    reporter.setGauge('queue', 2);
    final newFlush = reporter.flushTelemetry();
    expect(values, [1]);
    first.complete();
    await Future.wait([oldFlush, newFlush]);
    expect(values, [1, 2]);
    reporter.dispose();
  });

  test('disposal cancels a scheduled retry', () async {
    final release = Completer<void>();
    final scheduled = Completer<void>();
    var attempts = 0;
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        attempts++;
        handler.resolve(Response(requestOptions: options, statusCode: 503));
      }));
    final reporter = TelemetryReporter(
      appKey: 'key',
      httpClient: dio,
      delay: (_) {
        scheduled.complete();
        return release.future;
      },
    );
    reporter.recordCheck('flag', 'enabled');
    final flushing = reporter.flushTelemetry();
    await scheduled.future;
    reporter.dispose();
    await flushing.timeout(const Duration(milliseconds: 200));
    expect(attempts, 1);
    release.complete();
  });

  test('retry expires when a scheduled sleeper resumes too late', () async {
    var now = DateTime.utc(2026, 9, 18);
    var attempts = 0;
    final diagnostics = <String>[];
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        attempts++;
        handler.resolve(Response(requestOptions: options, statusCode: 503));
      }));
    final reporter = TelemetryReporter(
      appKey: 'key',
      httpClient: dio,
      clock: () => now,
      delay: (_) async => now = now.add(const Duration(minutes: 6)),
      onDiagnostic: diagnostics.add,
    );
    reporter.recordCheck('flag', 'enabled');
    await reporter.flushTelemetry();
    expect(attempts, 1);
    expect(diagnostics, contains('batch_expired'));
    reporter.dispose();
  });

  test('disposal releases the production retry wait promptly', () async {
    final firstAttempt = Completer<void>();
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        if (!firstAttempt.isCompleted) firstAttempt.complete();
        handler.resolve(Response(requestOptions: options, statusCode: 503));
      }));
    final reporter = TelemetryReporter(appKey: 'key', httpClient: dio);
    reporter.recordCheck('flag', 'enabled');
    final flushing = reporter.flushTelemetry();
    await firstAttempt.future;
    await Future<void>.delayed(const Duration(milliseconds: 10));
    reporter.dispose();
    await flushing.timeout(const Duration(milliseconds: 200));
  });

  test('idle disposal sends at most the oldest queued envelope', () async {
    final values = <num>[];
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (request, handler) {
        final data = request.data;
        final body =
            jsonDecode(data is String ? data : utf8.decode(gzip.decode(data)))
                as Map<String, dynamic>;
        values.add((body['m'] as Map)['orders'] as num);
        handler.resolve(Response(requestOptions: request, statusCode: 202));
      }));
    final reporter = TelemetryReporter(appKey: 'key', httpClient: dio);
    for (var i = 0; i < 3; i++) {
      reporter.incrementCounter('orders', 1000000);
    }
    reporter.dispose();
    await reporter.flushTelemetry();
    expect(values, [1000000]);
  });

  test('inflight disposal drops newer envelopes after the active attempt',
      () async {
    final entered = Completer<void>();
    final release = Completer<void>();
    final values = <num>[];
    final dio = Dio()
      ..interceptors
          .add(InterceptorsWrapper(onRequest: (request, handler) async {
        final data = request.data;
        final body =
            jsonDecode(data is String ? data : utf8.decode(gzip.decode(data)))
                as Map<String, dynamic>;
        values.add((body['m'] as Map)['orders'] as num);
        if (!entered.isCompleted) {
          entered.complete();
          await release.future;
        }
        handler.resolve(Response(requestOptions: request, statusCode: 202));
      }));
    final reporter = TelemetryReporter(appKey: 'key', httpClient: dio);
    for (var i = 0; i < 3; i++) {
      reporter.incrementCounter('orders', 1000000);
    }
    final flushing = reporter.flushTelemetry();
    await entered.future;
    reporter.dispose();
    release.complete();
    await flushing;
    expect(values, [1000000]);
  });

  test('disposal during retry wait drops remaining queued envelopes', () async {
    final scheduled = Completer<void>();
    final release = Completer<void>();
    var requests = 0;
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (request, handler) {
        requests++;
        handler.resolve(Response(requestOptions: request, statusCode: 503));
      }));
    final reporter = TelemetryReporter(
      appKey: 'key',
      httpClient: dio,
      delay: (_) {
        scheduled.complete();
        return release.future;
      },
    );
    for (var i = 0; i < 3; i++) {
      reporter.incrementCounter('orders', 1000000);
    }
    final flushing = reporter.flushTelemetry();
    await scheduled.future;
    reporter.dispose();
    await flushing.timeout(const Duration(milliseconds: 200));
    expect(requests, 1);
    release.complete();
  });

  test('disposal closes the owned persistent HTTP connection', () async {
    HttpOverrides.global = null;
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      await request.drain<void>();
      request.response.statusCode = 202;
      await request.response.close();
    });
    final reporter = TelemetryReporter(
      appKey: 'key',
      metricsBaseUrl: 'http://${server.address.host}:${server.port}',
    );
    try {
      reporter.recordCheck('flag', 'enabled');
      await reporter.flushTelemetry();
      expect(server.connectionsInfo().total, greaterThan(0));
      reporter.dispose();
      await reporter.flushTelemetry();
      for (var i = 0; i < 20 && server.connectionsInfo().total > 0; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
      expect(server.connectionsInfo().total, 0);
    } finally {
      reporter.dispose();
      await server.close(force: true);
    }
  });

  test('parses HTTP-date Retry-After before the bounded retry', () async {
    final waits = <Duration>[];
    var attempts = 0;
    final dio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        attempts++;
        handler.resolve(Response(
          requestOptions: options,
          statusCode: attempts == 1 ? 429 : 202,
          headers: Headers.fromMap({
            'retry-after': ['Fri, 18 Sep 2026 12:02:00 GMT']
          }),
        ));
      }));
    final reporter = TelemetryReporter(
      appKey: 'key',
      httpClient: dio,
      clock: () => DateTime.utc(2026, 9, 18, 12),
      delay: (duration) async => waits.add(duration),
    );
    reporter.recordCheck('flag', 'enabled');
    await reporter.flushTelemetry();
    expect(waits, [const Duration(minutes: 2)]);
    reporter.dispose();
  });
}
