import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// [TogglyCacheProvider] that persists cache entries as plain JSON files on
/// disk.
///
/// Each entry is a separate file under a `toggly_cache` directory. By default
/// the directory lives under the app documents directory (via `path_provider`);
/// inject a [directory] to use a custom location (also used by tests).
///
/// Writes are atomic (written to a temporary file then renamed). This backend
/// is not encrypted — use `feature_flags_toggly_secure_storage` if the cached
/// payloads must be protected at rest.
class DiskCacheProvider implements TogglyRevisionCacheProvider {
  static const String _jwksName = 'jwks.json';

  final Directory? _explicitDir;
  Directory? _resolvedDir;
  Future<Directory>? _pending;

  /// Creates a provider. When [directory] is null the app documents directory
  /// is used (resolved lazily on first access).
  DiskCacheProvider({Directory? directory}) : _explicitDir = directory;

  Future<Directory> _dir() async {
    if (_resolvedDir == null) {
      if (_explicitDir != null) {
        _resolvedDir = _explicitDir;
      } else {
        _pending ??= _resolveDefaultDir();
        _resolvedDir = await _pending;
      }
    }
    if (!await _resolvedDir!.exists()) {
      await _resolvedDir!.create(recursive: true);
    }
    return _resolvedDir!;
  }

  Future<Directory> _resolveDefaultDir() async {
    final base = await getApplicationDocumentsDirectory();
    return Directory(p.join(base.path, 'toggly_cache'));
  }

  /// URL-safe, collision-free file token derived from an identity.
  String _token(String identity) => base64Url.encode(utf8.encode(identity));

  String _flagsName(String identity) => 'flags_${_token(identity)}.json';
  String _variantsName(String identity) => 'variants_${_token(identity)}.json';
  String _revisionName(String appKey, String environment, String identity) =>
      'revision_${_token('$appKey:$environment:$identity')}.txt';

  String _legacyRevisionName(String appKey, String environment) =>
      'revision_${_token('$appKey:$environment')}.txt';

  Future<String?> _read(String name) async {
    try {
      final dir = await _dir();
      final file = File(p.join(dir.path, name));
      if (!await file.exists()) return null;
      return await file.readAsString();
    } catch (_) {
      return null;
    }
  }

  Future<void> _write(String name, String contents) async {
    final dir = await _dir();
    final tmp = File(p.join(dir.path, '$name.tmp'));
    await tmp.writeAsString(contents, flush: true);
    await tmp.rename(p.join(dir.path, name));
  }

  Future<void> _delete(String name) async {
    try {
      final dir = await _dir();
      final file = File(p.join(dir.path, name));
      if (await file.exists()) await file.delete();
    } catch (_) {
      // Best-effort delete.
    }
  }

  @override
  Future<TogglyFeatureFlagsCache?> readFlags(String identity) async {
    final raw = await _read(_flagsName(identity));
    if (raw == null) return null;
    try {
      return TogglyFeatureFlagsCache.fromJson(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> writeFlags(TogglyFeatureFlagsCache cache) =>
      _write(_flagsName(cache.identity), jsonEncode(cache.toJson()));

  @override
  Future<void> deleteFlags(String identity) => _delete(_flagsName(identity));

  @override
  Future<TogglyVariantsCache?> readVariants(String identity) async {
    final raw = await _read(_variantsName(identity));
    if (raw == null) return null;
    try {
      return TogglyVariantsCache.fromJson(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> writeVariants(TogglyVariantsCache cache) =>
      _write(_variantsName(cache.identity), jsonEncode(cache.toJson()));

  @override
  Future<void> deleteVariants(String identity) =>
      _delete(_variantsName(identity));

  @override
  Future<String?> readJwks() => _read(_jwksName);

  @override
  Future<void> writeJwks(String jwks) => _write(_jwksName, jwks);

  @override
  Future<void> deleteJwks() => _delete(_jwksName);

  @override
  Future<String?> readDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
  ) async {
    final name = _revisionName(appKey, environment, identity);
    final revision = await _read(name);
    if (revision != null) {
      return revision;
    }

    final legacyName = _legacyRevisionName(appKey, environment);
    final legacy = await _read(legacyName);
    if (legacy == null) {
      return null;
    }

    await _write(name, legacy);
    await _delete(legacyName);
    return legacy;
  }

  @override
  Future<void> writeDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
    String revision,
  ) =>
      _write(_revisionName(appKey, environment, identity), revision);

  @override
  Future<void> deleteDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
  ) =>
      _delete(_revisionName(appKey, environment, identity));
}
