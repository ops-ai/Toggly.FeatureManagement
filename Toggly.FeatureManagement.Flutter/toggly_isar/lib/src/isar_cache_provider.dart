import 'dart:convert';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:isar_community/isar.dart';
import 'package:path_provider/path_provider.dart';

import 'toggly_cache_entry.dart';

/// [TogglyCacheProvider] backed by an [Isar] database.
///
/// Because opening an Isar instance is asynchronous, construct this provider
/// via [IsarCacheProvider.open] before passing it to `Toggly.init`:
///
/// ```dart
/// final provider = await IsarCacheProvider.open();
/// await Toggly.init(
///   appKey: '<key>',
///   identity: userId,
///   config: TogglyConfig(cacheProvider: provider),
/// );
/// ```
class IsarCacheProvider implements TogglyRevisionCacheProvider {
  static const String _flagsPrefix = 'flags:';
  static const String _variantsPrefix = 'variants:';
  static const String _revisionPrefix = 'revision:';
  static const String _jwksKey = 'jwks';

  final Isar _isar;

  /// Wraps an already-open [isar] instance. Prefer [open] in app code.
  IsarCacheProvider(this._isar);

  /// Opens (or reuses) an Isar instance containing the Toggly cache schema.
  ///
  /// [directory] defaults to the app documents directory. [name] allows
  /// multiple isolated instances (used by tests).
  static Future<IsarCacheProvider> open({
    String? directory,
    String name = 'toggly_cache',
  }) async {
    final dir = directory ?? (await getApplicationDocumentsDirectory()).path;
    final existing = Isar.getInstance(name);
    final isar = existing ??
        await Isar.open([TogglyCacheEntrySchema], directory: dir, name: name);
    return IsarCacheProvider(isar);
  }

  /// Closes the underlying Isar instance.
  Future<void> close() => _isar.close();

  Future<String?> _read(String key) async {
    final entry = await _isar.togglyCacheEntrys.getByCacheKey(key);
    return entry?.payload;
  }

  Future<void> _write(String key, String payload) async {
    await _isar.writeTxn(() async {
      await _isar.togglyCacheEntrys.putByCacheKey(
        TogglyCacheEntry(
          cacheKey: key,
          payload: payload,
          updatedAt: DateTime.now().millisecondsSinceEpoch,
        ),
      );
    });
  }

  Future<void> _delete(String key) async {
    await _isar.writeTxn(() async {
      await _isar.togglyCacheEntrys.deleteByCacheKey(key);
    });
  }

  @override
  Future<TogglyFeatureFlagsCache?> readFlags(String identity) async {
    final raw = await _read('$_flagsPrefix$identity');
    if (raw == null) return null;
    try {
      return TogglyFeatureFlagsCache.fromJson(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> writeFlags(TogglyFeatureFlagsCache cache) =>
      _write('$_flagsPrefix${cache.identity}', jsonEncode(cache.toJson()));

  @override
  Future<void> deleteFlags(String identity) =>
      _delete('$_flagsPrefix$identity');

  @override
  Future<TogglyVariantsCache?> readVariants(String identity) async {
    final raw = await _read('$_variantsPrefix$identity');
    if (raw == null) return null;
    try {
      return TogglyVariantsCache.fromJson(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> writeVariants(TogglyVariantsCache cache) =>
      _write('$_variantsPrefix${cache.identity}', jsonEncode(cache.toJson()));

  @override
  Future<void> deleteVariants(String identity) =>
      _delete('$_variantsPrefix$identity');

  @override
  Future<String?> readJwks() => _read(_jwksKey);

  @override
  Future<void> writeJwks(String jwks) => _write(_jwksKey, jwks);

  @override
  Future<void> deleteJwks() => _delete(_jwksKey);

  String _revisionKey(String appKey, String environment, String identity) =>
      '$_revisionPrefix$appKey:$environment:$identity';

  String _legacyRevisionKey(String appKey, String environment) =>
      '$_revisionPrefix$appKey:$environment';

  @override
  Future<String?> readDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
  ) async {
    final key = _revisionKey(appKey, environment, identity);
    final revision = await _read(key);
    if (revision != null) {
      return revision;
    }

    final legacyKey = _legacyRevisionKey(appKey, environment);
    final legacy = await _read(legacyKey);
    if (legacy == null) {
      return null;
    }

    await _write(key, legacy);
    await _delete(legacyKey);
    return legacy;
  }

  @override
  Future<void> writeDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
    String revision,
  ) =>
      _write(_revisionKey(appKey, environment, identity), revision);

  @override
  Future<void> deleteDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
  ) =>
      _delete(_revisionKey(appKey, environment, identity));
}
