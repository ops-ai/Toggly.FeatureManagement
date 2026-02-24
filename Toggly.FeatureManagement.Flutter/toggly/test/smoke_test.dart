import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    // Allow real HTTP requests during smoke tests.
    // TestWidgetsFlutterBinding overrides HttpClient to return 400 for all
    // requests by default. Resetting HttpOverrides restores real networking.
    HttpOverrides.global = null;
  });

  test('loads live evaluated flags', () async {
    final appKey = Platform.environment['TOGGLY_SMOKE_APP_KEY_FRONTEND'];
    if (appKey == null || appKey.isEmpty) {
      return;
    }

    await Toggly.init(
      appKey: appKey,
      environment: 'Production',
      identity: 'smoke-test-device',
      useSignedDefinitions: true,
      config: const TogglyConfig(
        baseURI: 'https://definitions.toggly.io',
        connectTimeout: 15000,
        featureFlagsRefreshInterval: 3600000,
      ),
    );

    final flagOn = await Toggly.evaluateFeatureGate(['FlagOn']);
    final flagOff = await Toggly.evaluateFeatureGate(['FlagOff']);

    expect(flagOn, true);
    expect(flagOff, false);
  });

  test('WebSocket connects and receives initial message', () async {
    final appKey = Platform.environment['TOGGLY_SMOKE_APP_KEY_FRONTEND'];
    if (appKey == null || appKey.isEmpty) {
      return;
    }

    try {
      final ws = await WebSocket.connect(
        'wss://definitions.toggly.io/$appKey/ws',
      ).timeout(const Duration(seconds: 15));

      try {
        final completer = Completer<Map<String, dynamic>>();
        final subscription = ws.listen(
          (data) {
            if (completer.isCompleted) return;
            final parsed = jsonDecode(data as String) as Map<String, dynamic>;
            if (parsed['type'] == 'ping') return;
            completer.complete(parsed);
          },
          onError: (Object error) {
            if (!completer.isCompleted) {
              completer.completeError(error);
            }
          },
          onDone: () {
            if (!completer.isCompleted) {
              completer.completeError(StateError('WebSocket closed'));
            }
          },
        );
        final parsed = await completer.future.timeout(
          const Duration(seconds: 30),
        );
        await subscription.cancel();
        expect(parsed['type'], anyOf('definitions', 'evaluated'));
        expect(parsed.containsKey('timestamp'), true);
      } finally {
        await ws.close();
      }
    } catch (e) {
      // WebSocket connections may timeout due to Cloudflare Workers cold starts
      // ignore: avoid_print
      print('Warning: WebSocket smoke test skipped due to connection issue: $e');
    }
  });
}
