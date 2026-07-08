import 'dart:convert';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// [TogglyCacheProvider] backed by `flutter_secure_storage`.
///
/// Persists feature flags, variant definitions, and JWKS in the platform
/// secure store (Keychain on iOS/macOS, Keystore-backed `EncryptedSharedPreferences`
/// on Android, etc.). Pass an instance via
/// `TogglyConfig(cacheProvider: SecureStorageCacheProvider())` to enable
/// offline restart.
class SecureStorageCacheProvider implements TogglyRevisionCacheProvider {
  static const String _flagsPrefix = 'toggly.flags.';
  static const String _variantsPrefix = 'toggly.variants.';
  static const String _revisionPrefix = 'toggly.revision.';
  static const String _jwksKey = 'toggly.jwks';

  final FlutterSecureStorage _storage;

  /// Creates a provider. Inject a custom [storage] (e.g. with platform
  /// options) or a fake for testing; defaults to `const FlutterSecureStorage()`.
  SecureStorageCacheProvider({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  @override
  Future<TogglyFeatureFlagsCache?> readFlags(String identity) async {
    final raw = await _storage.read(key: '$_flagsPrefix$identity');
    if (raw == null) return null;
    try {
      return TogglyFeatureFlagsCache.fromJson(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> writeFlags(TogglyFeatureFlagsCache cache) {
    return _storage.write(
      key: '$_flagsPrefix${cache.identity}',
      value: jsonEncode(cache.toJson()),
    );
  }

  @override
  Future<void> deleteFlags(String identity) =>
      _storage.delete(key: '$_flagsPrefix$identity');

  @override
  Future<TogglyVariantsCache?> readVariants(String identity) async {
    final raw = await _storage.read(key: '$_variantsPrefix$identity');
    if (raw == null) return null;
    try {
      return TogglyVariantsCache.fromJson(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> writeVariants(TogglyVariantsCache cache) {
    return _storage.write(
      key: '$_variantsPrefix${cache.identity}',
      value: jsonEncode(cache.toJson()),
    );
  }

  @override
  Future<void> deleteVariants(String identity) =>
      _storage.delete(key: '$_variantsPrefix$identity');

  @override
  Future<String?> readJwks() => _storage.read(key: _jwksKey);

  @override
  Future<void> writeJwks(String jwks) =>
      _storage.write(key: _jwksKey, value: jwks);

  @override
  Future<void> deleteJwks() => _storage.delete(key: _jwksKey);

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
    final revision = await _storage.read(key: key);
    if (revision != null) {
      return revision;
    }

    final legacyKey = _legacyRevisionKey(appKey, environment);
    final legacy = await _storage.read(key: legacyKey);
    if (legacy == null) {
      return null;
    }

    await _storage.write(key: key, value: legacy);
    await _storage.delete(key: legacyKey);
    return legacy;
  }

  @override
  Future<void> writeDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
    String revision,
  ) =>
      _storage.write(
        key: _revisionKey(appKey, environment, identity),
        value: revision,
      );

  @override
  Future<void> deleteDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
  ) =>
      _storage.delete(key: _revisionKey(appKey, environment, identity));
}
