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

  test('WebSocket connects and flags are correct', () async {
    final appKey = Platform.environment['TOGGLY_SMOKE_APP_KEY_FRONTEND'];
    if (appKey == null || appKey.isEmpty) {
      return;
    }

    await Toggly.init(
      appKey: appKey,
      environment: 'Production',
      identity: 'smoke-test-device-ws',
      useSignedDefinitions: true,
      config: const TogglyConfig(
        baseURI: 'https://definitions.toggly.io',
        connectTimeout: 15000,
        featureFlagsRefreshInterval: 3600000,
        enableLiveUpdates: true,
      ),
    );

    // Wait up to 10 seconds for the sync service's WebSocket to connect
    final deadline = DateTime.now().add(const Duration(seconds: 10));
    while (!SyncService.getInstance.wsConnected &&
        DateTime.now().isBefore(deadline)) {
      await Future.delayed(const Duration(milliseconds: 200));
    }

    expect(SyncService.getInstance.wsConnected, true);

    final flagOn = await Toggly.evaluateFeatureGate(['FlagOn']);
    final flagOff = await Toggly.evaluateFeatureGate(['FlagOff']);

    expect(flagOn, true);
    expect(flagOff, false);

    Toggly.dispose();
  }, timeout: const Timeout(Duration(seconds: 60)));
}
