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

    final ws = await WebSocket.connect(
      'wss://definitions.toggly.io/$appKey/ws',
    );

    try {
      final message = await ws.first.timeout(
        const Duration(seconds: 10),
      );
      final parsed = jsonDecode(message as String) as Map<String, dynamic>;
      expect(parsed['type'], anyOf('definitions', 'evaluated'));
      expect(parsed.containsKey('timestamp'), true);
    } finally {
      await ws.close();
    }
  });
}
