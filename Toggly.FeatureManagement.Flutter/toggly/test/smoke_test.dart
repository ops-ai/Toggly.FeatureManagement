import 'dart:io';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('loads live evaluated flags', () async {
    final appKey = Platform.environment['TOGGLY_SMOKE_APP_KEY_FRONTEND'];
    if (appKey == null || appKey.isEmpty) {
      return;
    }

    await Toggly.init(
      appKey: appKey,
      environment: 'Production',
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
}
