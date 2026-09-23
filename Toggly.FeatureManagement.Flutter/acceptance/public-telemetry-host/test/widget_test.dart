import 'dart:convert';
import 'dart:io';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late HttpServer server;
  late List<Map<String, dynamic>> packets;
  late List<HttpRequest> requests;
  late String base;
  var telemetryStatus = 202;
  var closeWithoutResponse = false;

  setUp(() async {
    HttpOverrides.global = null;
    TestWidgetsFlutterBinding.instance.handleAppLifecycleStateChanged(
      AppLifecycleState.resumed,
    );
    telemetryStatus = 202;
    closeWithoutResponse = false;
    packets = [];
    requests = [];
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    base = 'http://127.0.0.1:${server.port}';
    server.listen((request) async {
      requests.add(request);
      if (request.uri.path == '/api/frontend/telemetry') {
        final bytes = await request.fold<List<int>>(
          [],
          (out, part) => out..addAll(part),
        );
        final body = request.headers.value('content-encoding') == 'gzip'
            ? gzip.decode(bytes)
            : bytes;
        packets.add(Map<String, dynamic>.from(jsonDecode(utf8.decode(body))));
        if (closeWithoutResponse) {
          request.response.detachSocket().then((socket) => socket.destroy());
          return;
        }
        request.response.statusCode = telemetryStatus;
      } else if (request.uri.path.contains('variants')) {
        request.response.headers.contentType = ContentType.json;
        request.response.write(
          jsonEncode({
            'defs': {
              'checkout': {
                'enabled': true,
                'variant': 'blue',
                'configurationValue': 7,
              },
            },
            'signature': 'fixture',
            'timestamp': 1,
            'kid': 'fixture',
          }),
        );
      } else {
        request.response.headers.contentType = ContentType.json;
        request.response.write(
          jsonEncode({
            'defs': {'checkout': true, 'disabled': false},
          }),
        );
      }
      await request.response.close();
    });
  });

  tearDown(() async {
    Toggly.dispose();
    await server.close(force: true);
  });

  Future<void> initialize({
    String? key = 'fixture-key',
    bool enabled = true,
    String? identity = 'user-a',
    String? instanceId,
  }) async {
    await Toggly.init(
      appKey: key,
      environment: 'Acceptance',
      identity: identity,
      instanceId: instanceId,
      useSignedDefinitions: false,
      flagDefaults: const {'checkout': true, 'disabled': false},
      config: TogglyConfig(
        baseURI: base,
        metricsBaseUrl: base,
        enableLiveUpdates: false,
        enableVariants: true,
        enableTelemetry: enabled,
      ),
    );
  }

  testWidgets('public facade and widget send compact native packets', (
    tester,
  ) async {
    await tester.runAsync(() => initialize());
    await tester.pumpWidget(
      const Directionality(
        textDirection: TextDirection.ltr,
        child: Column(
          children: [
            Feature(featureKeys: ['checkout'], child: Text('shown')),
            Feature(
              featureKeys: ['disabled'],
              negate: true,
              child: Text('negated'),
            ),
          ],
        ),
      ),
    );
    await tester.pump();
    expect(find.text('shown'), findsOneWidget);
    expect(find.text('negated'), findsOneWidget);
    expect(
      Toggly.evaluateFeatureGateSync([
        'checkout',
      ], flags: Toggly.featureFlagsSnapshot),
      isTrue,
    );
    expect(
      await tester.runAsync(
        () => Toggly.evaluateFeatureGate([
          'disabled',
          'checkout',
        ], requirement: FeatureRequirement.any),
      ),
      isTrue,
    );
    expect(
      await tester.runAsync(
        () => Toggly.evaluateFeatureGate(['disabled'], negate: true),
      ),
      isTrue,
    );
    expect(await tester.runAsync(() => Toggly.isFeatureOn('checkout')), isTrue);
    final variant = await tester.runAsync(() => Toggly.getVariant('checkout'));
    expect(variant?.name, 'blue');
    Toggly.recordUsage('checkout', 'blue');
    Toggly.recordView('checkout', 'blue');
    Toggly.incrementCounter('orders', 2);
    Toggly.setGauge('queue', 3.5);
    await tester.runAsync(Toggly.flushTelemetry);
    expect(packets, hasLength(1));
    final packet = packets.single;
    expect(packet['k'], 'fixture-key');
    expect(packet['e'], 'Acceptance');
    expect(packet['u'], 'user-a');
    expect(packet['i'], isNull);
    expect((packet['f'] as Map)['checkout'], {
      'blue': [5, 1, 1],
    });
    expect((packet['f'] as Map)['disabled'], contains('disabled'));
    expect(packet['m'], {'orders': 2, 'queue': 3.5});
    expect(
      packet.keys.toSet().difference({'k', 'e', 'u', 'i', 'f', 'm'}),
      isEmpty,
    );
    final telemetryRequest = requests.singleWhere(
      (r) => r.uri.path.endsWith('/api/frontend/telemetry'),
    );
    expect(telemetryRequest.headers.value('origin'), isNull);
    expect(telemetryRequest.headers.value('cookie'), isNull);
    expect(telemetryRequest.headers.value('authorization'), isNull);
  });

  test('keyless and opt-out keep evaluations but emit no telemetry', () async {
    await initialize(key: null);
    expect(await Toggly.isFeatureOn('checkout'), isTrue);
    Toggly.recordUsage('checkout');
    await Toggly.flushTelemetry();
    await initialize(enabled: false);
    expect(await Toggly.isFeatureOn('checkout'), isTrue);
    Toggly.recordUsage('checkout');
    await Toggly.flushTelemetry();
    expect(packets, isEmpty);
  });

  test('identity and context changes retain packet attribution', () async {
    await initialize(instanceId: 'local-token-a');
    Toggly.recordUsage('checkout');
    await Toggly.setContext(
      groups: ['local-group'],
      claims: {'role': 'tester'},
    );
    Toggly.recordView('checkout');
    await Toggly.flushTelemetry();
    expect(packets.last['i'], 'local-token-a');
    expect(packets.last['u'], isNull);
    await Toggly.setIdentity('user-b', instanceId: 'local-token-b');
    Toggly.recordUsage('checkout');
    await Toggly.flushTelemetry();
    expect(packets.last['i'], 'local-token-b');
    await Toggly.setIdentity(null);
    Toggly.recordUsage('checkout');
    await Toggly.flushTelemetry();
    expect(packets.last['i'], isNull);
    expect(packets.last['u'], isA<String>());
    expect(packets.last['u'], isNot('user-b'));
  });

  testWidgets('pause flushes; resume and disposal do not replay', (
    tester,
  ) async {
    await tester.runAsync(() => initialize());
    Toggly.recordUsage('checkout');
    await tester.runAsync(() async {
      TestWidgetsFlutterBinding.instance.handleAppLifecycleStateChanged(
        AppLifecycleState.paused,
      );
      await Future<void>.delayed(const Duration(milliseconds: 300));
    });
    expect(packets, hasLength(1));
    await tester.runAsync(() async {
      TestWidgetsFlutterBinding.instance.handleAppLifecycleStateChanged(
        AppLifecycleState.resumed,
      );
      await Future<void>.delayed(const Duration(milliseconds: 300));
      await Toggly.flushTelemetry();
    });
    expect(packets, hasLength(1));
    Toggly.dispose();
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 150));
    });
    expect(packets, hasLength(1));
  });

  test(
    '429 and 503 retry through the public facade',
    () async {
      await initialize();
      telemetryStatus = 429;
      Toggly.recordUsage('checkout');
      final first = Toggly.flushTelemetry();
      await Future<void>.delayed(const Duration(milliseconds: 150));
      expect(packets, hasLength(1));
      telemetryStatus = 503;
      await Future<void>.delayed(const Duration(seconds: 31));
      expect(packets, hasLength(2));
      telemetryStatus = 202;
      await first;
      expect(packets, hasLength(3));
      expect(
        packets.every(
          (p) => jsonEncode(p['f']) == jsonEncode(packets.first['f']),
        ),
        isTrue,
      );
    },
    timeout: const Timeout(Duration(minutes: 2)),
  );

  test('ambiguous transport close does not replay', () async {
    await initialize();
    closeWithoutResponse = true;
    Toggly.recordUsage('checkout');
    await Toggly.flushTelemetry();
    expect(packets, hasLength(1));
    await Toggly.flushTelemetry();
    expect(packets, hasLength(1));
  });
}
