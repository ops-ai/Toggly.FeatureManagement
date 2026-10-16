import 'dart:convert';
import 'dart:io';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late HttpServer server;
  late List<Map<String, dynamic>> sent;

  setUp(() async {
    HttpOverrides.global = null;
    TestWidgetsFlutterBinding.instance
        .handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    sent = [];
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      if (request.uri.path.endsWith('/api/frontend/telemetry')) {
        final bytes = await request
            .fold<List<int>>([], (all, chunk) => all..addAll(chunk));
        final decoded = request.headers.value('content-encoding') == 'gzip'
            ? gzip.decode(bytes)
            : bytes;
        sent.add(Map<String, dynamic>.from(jsonDecode(utf8.decode(decoded))));
        request.response.statusCode = 202;
      } else {
        request.response.headers.contentType = ContentType.json;
        request.response.write(jsonEncode({'defs': {'a': true}}));
      }
      await request.response.close();
    });
  });

  tearDown(() async {
    Toggly.dispose();
    await server.close(force: true);
  });

  TogglyConfig metricsConfig(String base, {bool systemMetrics = false}) =>
      TogglyConfig(
        baseURI: base,
        metricsBaseUrl: base,
        enableLiveUpdates: false,
        systemMetrics: systemMetrics,
      );

  test('does not publish system metrics when systemMetrics is false', () async {
    final base = 'http://${server.address.host}:${server.port}';
    await Toggly.init(
      appKey: 'test-key',
      useSignedDefinitions: false,
      config: metricsConfig(base),
    );

    FlutterError.onError!(
      FlutterErrorDetails(exception: Exception('ignored'), library: 'test'),
    );
    await Future<void>.delayed(const Duration(seconds: 10));
    await Toggly.flushTelemetry();

    expect(sent, isEmpty);
  }, timeout: const Timeout(Duration(seconds: 20)));

  test('does not publish system metrics when telemetry is disabled', () async {
    final base = 'http://${server.address.host}:${server.port}';
    await Toggly.init(
      appKey: 'test-key',
      useSignedDefinitions: false,
      config: TogglyConfig(
        baseURI: base,
        metricsBaseUrl: base,
        enableLiveUpdates: false,
        enableTelemetry: false,
        systemMetrics: true,
      ),
    );

    FlutterError.onError!(
      FlutterErrorDetails(exception: Exception('ignored'), library: 'test'),
    );
    await Future<void>.delayed(const Duration(seconds: 10));
    await Toggly.flushTelemetry();

    expect(sent, isEmpty);
  }, timeout: const Timeout(Duration(seconds: 20)));

  test('publishes ExceptionCount when systemMetrics is enabled', () async {
    final base = 'http://${server.address.host}:${server.port}';
    await Toggly.init(
      appKey: 'test-key',
      useSignedDefinitions: false,
      config: metricsConfig(base, systemMetrics: true),
    );

    FlutterError.onError!(
      FlutterErrorDetails(exception: Exception('boom'), library: 'test'),
    );
    PlatformDispatcher.instance.onError!(
      Exception('platform'),
      StackTrace.current,
    );
    await Future<void>.delayed(const Duration(seconds: 10));
    await Toggly.flushTelemetry();

    expect(sent, hasLength(1));
    expect(sent.single['m'], {'ExceptionCount': 2});
  }, timeout: const Timeout(Duration(seconds: 20)));

  test('dispose stops system metrics collection', () async {
    final base = 'http://${server.address.host}:${server.port}';
    await Toggly.init(
      appKey: 'test-key',
      useSignedDefinitions: false,
      config: metricsConfig(base, systemMetrics: true),
    );
    Toggly.dispose();

    FlutterError.onError!(
      FlutterErrorDetails(
          exception: Exception('after-dispose'), library: 'test'),
    );
    await Future<void>.delayed(const Duration(seconds: 10));
    await Toggly.flushTelemetry();

    expect(sent, isEmpty);
  }, timeout: const Timeout(Duration(seconds: 20)));

  test('reinitializing telemetry restarts system metrics wiring', () async {
    final base = 'http://${server.address.host}:${server.port}';
    final config = metricsConfig(base, systemMetrics: true);

    await Toggly.init(
      appKey: 'first-app',
      useSignedDefinitions: false,
      config: config,
    );
    await Toggly.init(
      appKey: 'second-app',
      useSignedDefinitions: false,
      config: config,
    );

    FlutterError.onError!(
      FlutterErrorDetails(exception: Exception('second'), library: 'test'),
    );
    await Future<void>.delayed(const Duration(seconds: 10));
    await Toggly.flushTelemetry();

    expect(sent, hasLength(1));
    expect(sent.single['k'], 'second-app');
    expect(sent.single['m'], {'ExceptionCount': 1});
  }, timeout: const Timeout(Duration(seconds: 20)));

  test('flush acceptance allows another ExceptionCount sample', () async {
    final base = 'http://${server.address.host}:${server.port}';
    await Toggly.init(
      appKey: 'test-key',
      useSignedDefinitions: false,
      config: metricsConfig(base, systemMetrics: true),
    );

    FlutterError.onError!(
      FlutterErrorDetails(exception: Exception('first'), library: 'test'),
    );
    await Future<void>.delayed(const Duration(seconds: 10));
    await Toggly.flushTelemetry();

    FlutterError.onError!(
      FlutterErrorDetails(exception: Exception('second'), library: 'test'),
    );
    await Future<void>.delayed(const Duration(seconds: 10));
    await Toggly.flushTelemetry();

    expect(sent, hasLength(2));
    expect(sent.first['m'], {'ExceptionCount': 1});
    expect(sent.last['m'], {'ExceptionCount': 1});
  }, timeout: const Timeout(Duration(seconds: 30)));
}
