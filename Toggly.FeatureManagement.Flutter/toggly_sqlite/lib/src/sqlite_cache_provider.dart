import 'dart:async';
import 'dart:convert';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// [TogglyCacheProvider] backed by SQLite via `sqflite`.
///
/// Stores all cache entries in a single `toggly_cache` table keyed by
/// `(kind, identity)`. Pass an instance via
/// `TogglyConfig(cacheProvider: SqliteCacheProvider())` to enable offline
/// restart.
///
/// A custom [dbFactory] and [path] can be injected (used by tests with
/// `sqflite_common_ffi`). By default the global `sqflite` factory and the
/// platform databases directory are used.
class SqliteCacheProvider implements TogglyRevisionCacheProvider {
  static const String _table = 'toggly_cache';
  static const String _kindFlags = 'flags';
  static const String _kindVariants = 'variants';
  static const String _kindRevision = 'revision';
  static const String _kindJwks = 'jwks';

  // JWKS is a single, identity-independent row.
  static const String _jwksIdentity = '__jwks__';

  final DatabaseFactory _factory;
  final String? _path;
  Database? _db;
  Future<Database>? _pending;

  SqliteCacheProvider({DatabaseFactory? dbFactory, String? path})
      : _factory = dbFactory ?? databaseFactory,
        _path = path;

  Future<Database> _database() async {
    if (_db != null) return _db!;
    _pending ??= _open();
    _db = await _pending;
    return _db!;
  }

  Future<Database> _open() async {
    final dbPath =
        _path ?? p.join(await _factory.getDatabasesPath(), 'toggly_cache.db');
    return _factory.openDatabase(
      dbPath,
      options: OpenDatabaseOptions(
        version: 1,
        onCreate: (db, version) async {
          await db.execute('''
            CREATE TABLE $_table (
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
  }

  /// Closes the underlying database. Optional; primarily useful in tests.
  Future<void> close() async {
    final db = _db;
    _db = null;
    _pending = null;
    await db?.close();
  }

  Future<String?> _read(String kind, String identity) async {
    try {
      final db = await _database();
      final rows = await db.query(
        _table,
        columns: ['payload'],
        where: 'kind = ? AND identity = ?',
        whereArgs: [kind, identity],
        limit: 1,
      );
      if (rows.isEmpty) return null;
      return rows.first['payload'] as String?;
    } catch (_) {
      return null;
    }
  }

  Future<void> _write(String kind, String identity, String payload) async {
    final db = await _database();
    await db.insert(
        _table,
        {
          'kind': kind,
          'identity': identity,
          'payload': payload,
          'updated_at': DateTime.now().millisecondsSinceEpoch,
        },
        conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> _delete(String kind, String identity) async {
    try {
      final db = await _database();
      await db.delete(
        _table,
        where: 'kind = ? AND identity = ?',
        whereArgs: [kind, identity],
      );
    } catch (_) {
      // Best-effort delete.
    }
  }

  @override
  Future<TogglyFeatureFlagsCache?> readFlags(String identity) async {
    final raw = await _read(_kindFlags, identity);
    if (raw == null) return null;
    try {
      return TogglyFeatureFlagsCache.fromJson(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> writeFlags(TogglyFeatureFlagsCache cache) =>
      _write(_kindFlags, cache.identity, jsonEncode(cache.toJson()));

  @override
  Future<void> deleteFlags(String identity) => _delete(_kindFlags, identity);

  @override
  Future<TogglyVariantsCache?> readVariants(String identity) async {
    final raw = await _read(_kindVariants, identity);
    if (raw == null) return null;
    try {
      return TogglyVariantsCache.fromJson(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> writeVariants(TogglyVariantsCache cache) =>
      _write(_kindVariants, cache.identity, jsonEncode(cache.toJson()));

  @override
  Future<void> deleteVariants(String identity) =>
      _delete(_kindVariants, identity);

  @override
  Future<String?> readJwks() => _read(_kindJwks, _jwksIdentity);

  @override
  Future<void> writeJwks(String jwks) => _write(_kindJwks, _jwksIdentity, jwks);

  @override
  Future<void> deleteJwks() => _delete(_kindJwks, _jwksIdentity);

  String _revisionIdentity(
          String appKey, String environment, String identity) =>
      '$appKey:$environment:$identity';

  String _legacyRevisionIdentity(String appKey, String environment) =>
      '$appKey:$environment';

  @override
  Future<String?> readDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
  ) async {
    final scopedIdentity = _revisionIdentity(appKey, environment, identity);
    final revision = await _read(_kindRevision, scopedIdentity);
    if (revision != null) {
      return revision;
    }

    final legacyIdentity = _legacyRevisionIdentity(appKey, environment);
    final legacy = await _read(_kindRevision, legacyIdentity);
    if (legacy == null) {
      return null;
    }

    await _write(_kindRevision, scopedIdentity, legacy);
    await _delete(_kindRevision, legacyIdentity);
    return legacy;
  }

  @override
  Future<void> writeDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
    String revision,
  ) =>
      _write(
        _kindRevision,
        _revisionIdentity(appKey, environment, identity),
        revision,
      );

  @override
  Future<void> deleteDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
  ) =>
      _delete(_kindRevision, _revisionIdentity(appKey, environment, identity));
}
