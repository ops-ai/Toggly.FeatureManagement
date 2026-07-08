import 'dart:io';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:feature_flags_toggly_sqlite/feature_flags_toggly_sqlite.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/cache_provider_contract.dart';

void main() {
  late Directory tempDir;

  setUpAll(() {
    // Run sqflite on the Dart VM (no emulator) using the FFI implementation.
    sqfliteFfiInit();
  });

  // A fresh on-disk database per test. We deliberately avoid the shared
  // in-memory database: sqflite opens with singleInstance: true, so every
  // provider pointed at `:memory:` would share one process-wide database and
  // leak state across tests (only surfacing under randomized ordering).
  setUp(() {
    tempDir = Directory.systemTemp.createTempSync('toggly_sqlite_test');
  });

  tearDown(() {
    if (tempDir.existsSync()) {
      tempDir.deleteSync(recursive: true);
    }
  });

  group('SqliteCacheProvider', () {
    runCacheProviderContract(
      () => SqliteCacheProvider(
        dbFactory: databaseFactoryFfi,
        path: p.join(tempDir.path, 'toggly_cache.db'),
      ),
    );

    test('data persists across provider instances on the same file', () async {
      final dir = Directory.systemTemp.createTempSync('toggly_sqlite_test');
      addTearDown(() {
        if (dir.existsSync()) dir.deleteSync(recursive: true);
      });
      final dbPath = p.join(dir.path, 'toggly_cache.db');

      final writer = SqliteCacheProvider(
        dbFactory: databaseFactoryFfi,
        path: dbPath,
      );
      await writer.writeFlags(
        TogglyFeatureFlagsCache(
          identity: 'user-1',
          flags: '{"A":true}',
          timestamp: 1,
          signature: 's',
          keyId: 'k',
        ),
      );
      await writer.close();

      final reader = SqliteCacheProvider(
        dbFactory: databaseFactoryFfi,
        path: dbPath,
      );
      final read = await reader.readFlags('user-1');
      expect(read, isNotNull);
      expect(read!.flags, '{"A":true}');
      await reader.close();
    });

    test('corrupt stored payload is treated as a miss', () async {
      final dir = Directory.systemTemp.createTempSync('toggly_sqlite_corrupt');
      addTearDown(() {
        if (dir.existsSync()) dir.deleteSync(recursive: true);
      });
      final dbPath = p.join(dir.path, 'corrupt.db');

      final provider = SqliteCacheProvider(
        dbFactory: databaseFactoryFfi,
        path: dbPath,
      );
      await provider.writeFlags(
        TogglyFeatureFlagsCache(
          identity: 'user-1',
          flags: '{"A":true}',
          timestamp: 1,
          signature: 's',
          keyId: 'k',
        ),
      );
      await provider.close();

      // Corrupt the stored payload directly in the database.
      final raw = await databaseFactoryFfi.openDatabase(dbPath);
      await raw.update(
        'toggly_cache',
        {'payload': 'not-json{'},
        where: 'kind = ?',
        whereArgs: ['flags'],
      );
      await raw.close();

      final reader = SqliteCacheProvider(
        dbFactory: databaseFactoryFfi,
        path: dbPath,
      );
      expect(await reader.readFlags('user-1'), isNull);
      await reader.close();
    });
  });

  group('definitions revision', () {
    const identityA = 'u:user-a';
    const identityB = 'u:user-b';
    late SqliteCacheProvider provider;

    setUp(() {
      provider = SqliteCacheProvider(
        dbFactory: databaseFactoryFfi,
        path: p.join(tempDir.path, 'revision.db'),
      );
    });

    tearDown(() async {
      await provider.close();
    });

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

    test('migrates legacy appKey/environment revision rows on read', () async {
      final dbPath = p.join(tempDir.path, 'legacy_revision.db');
      final db = await databaseFactoryFfi.openDatabase(
        dbPath,
        options: OpenDatabaseOptions(
          version: 1,
          onCreate: (database, version) async {
            await database.execute('''
              CREATE TABLE toggly_cache (
                kind TEXT NOT NULL,
                identity TEXT NOT NULL,
                payload TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (kind, identity)
              )
            ''');
          },
        ),
      );
      await db.insert('toggly_cache', {
        'kind': 'revision',
        'identity': 'app-1:Production',
        'payload': 'legacy-rev',
        'updated_at': DateTime.now().millisecondsSinceEpoch,
      });
      await db.close();

      final reader = SqliteCacheProvider(
        dbFactory: databaseFactoryFfi,
        path: dbPath,
      );
      expect(
        await reader.readDefinitionsRevision('app-1', 'Production', identityA),
        'legacy-rev',
      );

      final verifyDb = await databaseFactoryFfi.openDatabase(dbPath);
      final rows = await verifyDb.query(
        'toggly_cache',
        where: 'kind = ?',
        whereArgs: ['revision'],
      );
      expect(rows.length, 1);
      expect(rows.first['identity'], 'app-1:Production:u:user-a');
      await verifyDb.close();
      await reader.close();
    });
  });
}
