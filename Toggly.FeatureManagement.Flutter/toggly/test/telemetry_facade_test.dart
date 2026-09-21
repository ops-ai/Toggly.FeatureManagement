import 'dart:convert';
import 'dart:io';
import 'dart:async';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late HttpServer server;
  late List<Map<String, dynamic>> sent;
  late Completer<void> telemetryArrived;
  late Completer<void> twoTelemetryArrived;
  late Map<String, dynamic> definitions;
  late Map<String, dynamic> variantDefinitions;
  setUp(() async {
    HttpOverrides.global = null;
    TestWidgetsFlutterBinding.instance
        .handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    sent = [];
    telemetryArrived = Completer<void>();
    twoTelemetryArrived = Completer<void>();
    definitions = {'a': true, 'b': false, 'c': true};
    variantDefinitions = {
      'a': {'enabled': true, 'variant': 'blue', 'configurationValue': 7},
    };
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      if (request.uri.path.endsWith('/api/frontend/telemetry')) {
        final bytes = await request
            .fold<List<int>>([], (all, chunk) => all..addAll(chunk));
        final decoded = request.headers.value('content-encoding') == 'gzip'
            ? gzip.decode(bytes)
            : bytes;
        sent.add(Map<String, dynamic>.from(jsonDecode(utf8.decode(decoded))));
        if (!telemetryArrived.isCompleted) telemetryArrived.complete();
        if (sent.length >= 2 && !twoTelemetryArrived.isCompleted) {
          twoTelemetryArrived.complete();
        }
        request.response.statusCode = 202;
      } else if (request.uri.path.contains('evaluated-variants-signed')) {
        request.response.write(jsonEncode({
          'defs': variantDefinitions,
          'signature': 'test',
          'timestamp': 1,
          'kid': 'test',
        }));
      } else {
        request.response.headers.contentType = ContentType.json;
        request.response.write(jsonEncode({'defs': definitions}));
      }
      await request.response.close();
    });
  });

  tearDown(() async {
    Toggly.dispose();
    await server.close(force: true);
  });

  test('counts evaluated leaves once and explicit events without evaluation',
      () async {
    final base = 'http://${server.address.host}:${server.port}';
    await Toggly.init(
      appKey: 'test-key',
      environment: 'QA',
      identity: 'secret-identity',
      groups: ['secret-group'],
      claims: {'secret': 'claim'},
      useSignedDefinitions: false,
      config: TogglyConfig(
        baseURI: base,
        metricsBaseUrl: base,
        enableLiveUpdates: false,
      ),
    );

    expect(
        Toggly.evaluateFeatureGateSync(['a', 'b', 'c'],
            flags: Toggly.featureFlagsSnapshot),
        false);
    expect(
        await Toggly.evaluateFeatureGate(['b', 'a', 'c'],
            requirement: FeatureRequirement.any, negate: true),
        false);
    Toggly.recordUsage('a');
    Toggly.recordView('a');
    Toggly.incrementCounter('orders', 2);
    Toggly.setGauge('queue', 3);
    await Toggly.flushTelemetry();

    expect(sent, hasLength(1));
    expect(sent.single, {
      'k': 'test-key',
      'e': 'QA',
      'u': 'secret-identity',
      'f': {
        'a': {
          'enabled': [2, 1, 1]
        },
        'b': {
          'disabled': [2]
        },
      },
      'm': {'orders': 2, 'queue': 3},
    });
  });

  test('getVariantValue records one assigned variant check', () async {
    final base = 'http://${server.address.host}:${server.port}';
    await Toggly.init(
      appKey: 'test-key',
      useSignedDefinitions: false,
      config: TogglyConfig(
        baseURI: base,
        metricsBaseUrl: base,
        enableLiveUpdates: false,
        enableVariants: true,
      ),
    );
    expect(await Toggly.getVariantValue('a'), 7);
    await Toggly.flushTelemetry();
    expect(sent.single['f'], {
      'a': {
        'blue': [1]
      }
    });
  });

  test('variant checks capture attribution before a reentrant local gate',
      () async {
    final base = 'http://${server.address.host}:${server.port}';
    await Toggly.init(
        appKey: 'test-key',
        identity: 'alice',
        instanceId: 'token-a',
        useSignedDefinitions: false,
        config: TogglyConfig(
            baseURI: base,
            metricsBaseUrl: base,
            enableLiveUpdates: false,
            enableVariants: true));
    Future<TogglyInitResponse>? changed;
    Toggly.setLocalGates([
      LocalGate(
          id: 'switch',
          flagKeys: ['a'],
          isEnabled: () {
            changed = Toggly.setIdentity('bob', instanceId: 'token-b');
            return true;
          })
    ]);
    final result = await Toggly.getVariant('a');
    expect(result.name, 'blue');
    await changed;
    Toggly.incrementCounter('new');
    await Toggly.flushTelemetry();
    expect(sent.where((b) => b['i'] == 'token-a').single['f'], {
      'a': {
        'blue': [1]
      }
    });
    expect(sent.where((b) => b['i'] == 'token-b').single['m'], {'new': 1});
  });

  test('entity mapper replacement preserves flags and attribution snapshot',
      () async {
    final base = 'http://${server.address.host}:${server.port}';
    await Toggly.init(
        appKey: 'test-key',
        identity: 'alice',
        useSignedDefinitions: false,
        config: TogglyConfig(
            baseURI: base, metricsBaseUrl: base, enableLiveUpdates: false));
    Future<TogglyInitResponse>? changed;
    Toggly.registerContext('Order', (_) {
      changed = Toggly.setIdentity('bob');
      return const TogglyEntityContext(
          kind: 'Order', key: 'one', attributes: {});
    });
    expect(
        Toggly.evaluateFeatureGateSync(['a'],
            flags: Toggly.featureFlagsSnapshot,
            context: Object(),
            kind: 'Order'),
        true);
    await changed;
    Toggly.incrementCounter('new');
    await Toggly.flushTelemetry();
    expect(sent.where((b) => b['u'] == 'alice').single['f'], {
      'a': {
        'enabled': [1]
      }
    });
  });

  test('background lifecycle flushes after reinitialization', () async {
    final base = 'http://${server.address.host}:${server.port}';
    await Toggly.init(
      appKey: 'test-key',
      useSignedDefinitions: false,
      config: TogglyConfig(
          baseURI: base, metricsBaseUrl: base, enableLiveUpdates: false),
    );
    Toggly.dispose();
    await Toggly.init(
      appKey: 'test-key',
      useSignedDefinitions: false,
      config: TogglyConfig(
          baseURI: base, metricsBaseUrl: base, enableLiveUpdates: false),
    );
    Toggly.incrementCounter('orders');
    TestWidgetsFlutterBinding.instance
        .handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await telemetryArrived.future.timeout(const Duration(seconds: 1));
    expect(sent.single['m'], {'orders': 1});
  });

  test('malformed variant metadata never changes sync or async booleans',
      () async {
    variantDefinitions = {
      'a': {'enabled': true, 'variant': 123},
    };
    final base = 'http://${server.address.host}:${server.port}';
    for (final enabled in [false, true]) {
      await Toggly.init(
        appKey: 'test-key',
        useSignedDefinitions: false,
        config: TogglyConfig(
          baseURI: base,
          metricsBaseUrl: base,
          enableLiveUpdates: false,
          enableVariants: true,
          enableTelemetry: enabled,
        ),
      );
      expect(
          Toggly.evaluateFeatureGateSync(['a'],
              flags: Toggly.featureFlagsSnapshot),
          true);
      expect(await Toggly.isFeatureOn('a'), true);
      await Toggly.flushTelemetry();
    }
    expect(sent, hasLength(1));
    expect(sent.single['f'], {
      'a': {
        'enabled': [2]
      }
    });
  });

  test('local and entity gates record effective leaf outcomes', () async {
    definitions = {
      'a': true,
      'gated': {
        'requirement': 'all',
        'rules': [
          {'property': 'Color', 'op': 'eq', 'value': 'red'},
        ],
      },
    };
    final base = 'http://${server.address.host}:${server.port}';
    await Toggly.init(
      appKey: 'test-key',
      useSignedDefinitions: false,
      config: TogglyConfig(
        baseURI: base,
        metricsBaseUrl: base,
        enableLiveUpdates: false,
        localGates: [
          LocalGate(id: 'off', flagKeys: ['a'], isEnabled: () => false),
        ],
      ),
    );
    final flags = Toggly.featureFlagsSnapshot;
    const red = TogglyEntityContext(
        kind: 'Order', key: '1', attributes: {'Color': 'red'});
    const blue = TogglyEntityContext(
        kind: 'Order', key: '2', attributes: {'Color': 'blue'});
    expect(Toggly.evaluateFeatureGateSync(['a'], flags: flags), false);
    expect(Toggly.evaluateFeatureGateSync(['gated'], flags: flags), false);
    expect(
        Toggly.evaluateFeatureGateSync(['gated'], flags: flags, context: red),
        true);
    expect(
        Toggly.evaluateFeatureGateSync(['gated'], flags: flags, context: blue),
        false);
    expect(await Toggly.isFeatureOn('a'), false);
    expect(await Toggly.isFeatureOn('gated', context: red), true);
    await Toggly.flushTelemetry();
    expect(sent.single['f'], {
      'a': {
        'disabled': [2]
      },
      'gated': {
        'disabled': [2],
        'enabled': [2]
      }
    });
  });

  test('different app and environment reinitialization isolates batches',
      () async {
    final base = 'http://${server.address.host}:${server.port}';
    final config = TogglyConfig(
        baseURI: base, metricsBaseUrl: base, enableLiveUpdates: false);
    await Toggly.init(
        appKey: 'first-app',
        identity: 'first-owner',
        environment: 'First',
        useSignedDefinitions: false,
        config: config);
    Toggly.recordUsage('first');
    await Toggly.init(
        appKey: 'second-app',
        identity: 'second-owner',
        environment: 'Second',
        useSignedDefinitions: false,
        config: config);
    Toggly.recordUsage('second');
    await Toggly.flushTelemetry();
    await twoTelemetryArrived.future.timeout(const Duration(seconds: 2));
    expect(sent, hasLength(2));
    final byApp = {for (final body in sent) body['k']: body};
    expect(byApp.keys, containsAll(['first-app', 'second-app']));
    expect(byApp['first-app'], {
      'k': 'first-app',
      'e': 'First',
      'u': 'first-owner',
      'f': {
        'first': {
          'enabled': [0, 1]
        }
      }
    });
    expect(byApp['second-app'], {
      'k': 'second-app',
      'e': 'Second',
      'u': 'second-owner',
      'f': {
        'second': {
          'enabled': [0, 1]
        }
      }
    });
  });

  testWidgets('widget recomputation records one check per gate evaluation',
      (tester) async {
    final base = 'http://${server.address.host}:${server.port}';
    await tester.runAsync(() => Toggly.init(
          appKey: 'test-key',
          useSignedDefinitions: false,
          config: TogglyConfig(
            baseURI: base,
            metricsBaseUrl: base,
            enableLiveUpdates: false,
            enableVariants: true,
          ),
        ));
    Widget gateWidget() => Directionality(
          textDirection: TextDirection.ltr,
          child: FeatureGateBuilder(
            featureKeys: const ['a'],
            variant: 'blue',
            builder: (context, enabled) => Text('enabled:$enabled'),
          ),
        );
    await tester.pumpWidget(gateWidget());
    await tester.pumpAndSettle();
    await tester.runAsync(Toggly.flushTelemetry);
    final initial = sent.fold<int>(
        0, (sum, body) => sum + ((body['f'] as Map)['a']['blue'][0] as int));
    expect(initial, greaterThanOrEqualTo(1));

    await tester.pumpWidget(gateWidget());
    await tester.pumpAndSettle();
    await tester.runAsync(Toggly.flushTelemetry);
    final after = sent.fold<int>(
        0, (sum, body) => sum + ((body['f'] as Map)['a']['blue'][0] as int));
    expect(after - initial, 1);
  });
}
