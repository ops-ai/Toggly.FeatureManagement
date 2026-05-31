import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:feature_flags_toggly_isar/feature_flags_toggly_isar.dart';

/// Minimal example showing how to wire the Isar cache provider into the Toggly
/// Flutter SDK for offline-capable feature flags.
Future<void> main() async {
  final cacheProvider = await IsarCacheProvider.open();

  await Toggly.init(
    appKey: '<your-app-key>',
    environment: 'Production',
    // A stable identity is required for offline restart.
    identity: 'user-123',
    config: TogglyConfig(cacheProvider: cacheProvider),
  );

  final isEnabled = await Toggly.evaluateFeatureGate(['MyFeature']);
  // ignore: avoid_print
  print('MyFeature enabled: $isEnabled');
}
