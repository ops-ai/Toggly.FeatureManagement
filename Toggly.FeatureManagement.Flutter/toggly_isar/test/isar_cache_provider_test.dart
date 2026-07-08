import 'dart:io';

import 'package:feature_flags_toggly_isar/feature_flags_toggly_isar.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isar_community/isar.dart';

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

  group('definitions revision', () {
    const identityA = 'u:user-a';
    const identityB = 'u:user-b';

    test('write then read round-trips by appKey and environment', () async {
      await provider.writeDefinitionsRevision(
        'app-1',
        'Production',
        identityA,
        '"etag-abc"',
      );
      expect(
        await provider.readDefinitionsRevision(
            'app-1', 'Production', identityA),
        '"etag-abc"',
      );
    });

    test('different appKey/environment pairs are isolated', () async {
      await provider.writeDefinitionsRevision(
          'app-1', 'Production', identityA, 'rev-a');
      await provider.writeDefinitionsRevision(
          'app-1', 'Staging', identityA, 'rev-b');
      await provider.writeDefinitionsRevision(
          'app-2', 'Production', identityA, 'rev-c');

      expect(
          await provider.readDefinitionsRevision(
              'app-1', 'Production', identityA),
          'rev-a');
      expect(
          await provider.readDefinitionsRevision('app-1', 'Staging', identityA),
          'rev-b');
      expect(
          await provider.readDefinitionsRevision(
              'app-2', 'Production', identityA),
          'rev-c');
    });

    test('different evaluation identities are isolated', () async {
      await provider.writeDefinitionsRevision(
          'app-1', 'Production', identityA, 'rev-a');
      await provider.writeDefinitionsRevision(
          'app-1', 'Production', identityB, 'rev-b');

      expect(
          await provider.readDefinitionsRevision(
              'app-1', 'Production', identityA),
          'rev-a');
      expect(
          await provider.readDefinitionsRevision(
              'app-1', 'Production', identityB),
          'rev-b');
    });

    test('delete removes the revision entry', () async {
      await provider.writeDefinitionsRevision(
          'app-1', 'Production', identityA, 'rev-a');
      await provider.deleteDefinitionsRevision(
          'app-1', 'Production', identityA);
      expect(
        await provider.readDefinitionsRevision(
            'app-1', 'Production', identityA),
        isNull,
      );
    });

    test('migrates legacy appKey/environment revision keys on read', () async {
      const isarName = 'legacy_migration_test';
      final migrationProvider = await IsarCacheProvider.open(
        directory: dir.path,
        name: isarName,
      );
      final isar = Isar.getInstance(isarName)!;

      await isar.writeTxn(() async {
        await isar.togglyCacheEntrys.putByCacheKey(
          TogglyCacheEntry(
            cacheKey: 'revision:app-1:Production',
            payload: 'legacy-rev',
            updatedAt: DateTime.now().millisecondsSinceEpoch,
          ),
        );
      });

      expect(
        await migrationProvider.readDefinitionsRevision(
          'app-1',
          'Production',
          identityA,
        ),
        'legacy-rev',
      );
      expect(
        await isar.togglyCacheEntrys.getByCacheKey('revision:app-1:Production'),
        isNull,
      );
      expect(
        await isar.togglyCacheEntrys.getByCacheKey(
          'revision:app-1:Production:u:user-a',
        ),
        isNotNull,
      );

      await migrationProvider.close();
    });
  });
}
