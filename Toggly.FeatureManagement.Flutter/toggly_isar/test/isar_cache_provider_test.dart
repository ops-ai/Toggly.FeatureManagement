import 'dart:io';

import 'package:feature_flags_toggly_isar/feature_flags_toggly_isar.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isar/isar.dart';

import 'support/cache_provider_contract.dart';

void main() {
  setUpAll(() async {
    // Download the Isar native library for the test VM (desktop).
    // Note: we deliberately do NOT call TestWidgetsFlutterBinding here, because
    // that binding stubs out HttpClient (returning 400) and blocks the download.
    await Isar.initializeIsarCore(download: true);
  });

  late Directory dir;
  late IsarCacheProvider provider;

  setUp(() async {
    dir = Directory.systemTemp.createTempSync('toggly_isar_test');
    provider = await IsarCacheProvider.open(
      directory: dir.path,
      name: 'test_${DateTime.now().microsecondsSinceEpoch}',
    );
  });

  tearDown(() async {
    await provider.close();
    if (dir.existsSync()) {
      dir.deleteSync(recursive: true);
    }
  });

  group('IsarCacheProvider', () {
    runCacheProviderContract(() => provider);
  });
}
