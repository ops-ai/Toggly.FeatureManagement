import 'cache_lru.dart';
import 'toggly_cache_provider.dart';
import '../models/toggly_cache_models.dart';

/// Wraps a [TogglyCacheProvider] with opt-in last-accessed LRU eviction.
///
/// Tracked logical keys (sidecar index `entries`):
/// - `flags:{identity}`
/// - `variants:{identity}`
/// - `revision:{appKey}:{environment}:{identity}`
///
/// JWKS is never tracked. Index I/O failures are swallowed so cache
/// read/write of flags still succeeds.
///
/// When [inner] implements [TogglyRevisionCacheProvider], the returned
/// instance also implements that interface and delegates revision methods.
class LruTogglyCacheProvider implements TogglyCacheProvider {
  final TogglyCacheProvider _inner;
  final int maxCacheKeys;
  final int Function() _nowMs;
  Future<void> _indexMutationQueue = Future.value();

  LruTogglyCacheProvider._(
    this._inner, {
    required this.maxCacheKeys,
    int Function()? nowMs,
  }) : _nowMs = nowMs ?? (() => DateTime.now().millisecondsSinceEpoch);

  /// Serializes index read-modify-write so concurrent writes do not lose updates.
  Future<T> _runSerializedIndexMutation<T>(Future<T> Function() action) {
    final result = _indexMutationQueue.then((_) => action());
    _indexMutationQueue = result.then((_) {}, onError: (_) {});
    return result;
  }

  /// Creates an LRU wrapper around [inner].
  ///
  /// When [maxCacheKeys] is non-positive, tracking and eviction are disabled
  /// (unlimited). Prefer constructing only when [isCacheLruEnabled] is true.
  factory LruTogglyCacheProvider(
    TogglyCacheProvider inner, {
    required int maxCacheKeys,
    int Function()? nowMs,
  }) {
    if (inner is TogglyRevisionCacheProvider) {
      return _LruRevisionTogglyCacheProvider(
        inner,
        maxCacheKeys: maxCacheKeys,
        nowMs: nowMs,
      );
    }
    return LruTogglyCacheProvider._(
      inner,
      maxCacheKeys: maxCacheKeys,
      nowMs: nowMs,
    );
  }

  /// The wrapped provider.
  TogglyCacheProvider get inner => _inner;

  bool get _enabled => isCacheLruEnabled(maxCacheKeys);

  Future<CacheLruIndex> _loadIndex() async {
    try {
      return parseCacheLruIndex(await _inner.readCacheLruIndex());
    } catch (_) {
      return emptyCacheLruIndex();
    }
  }

  Future<void> _saveIndex(CacheLruIndex index) async {
    try {
      await _inner.writeCacheLruIndex(serializeCacheLruIndex(index));
    } catch (_) {
      // Index persistence must not fail flag evaluation / refresh.
    }
  }

  List<String> _protectKeysForLogicalKey(String logicalKey) {
    if (logicalKey.startsWith('flags:')) {
      final identity = logicalKey.substring('flags:'.length);
      return [flagsKey(identity), variantsKey(identity)];
    }
    if (logicalKey.startsWith('variants:')) {
      final identity = logicalKey.substring('variants:'.length);
      return [flagsKey(identity), variantsKey(identity)];
    }
    if (logicalKey.startsWith('revision:')) {
      final rest = logicalKey.substring('revision:'.length);
      final parts = rest.split(':');
      if (parts.length < 3) {
        return [logicalKey];
      }
      final appKey = parts[0];
      final environment = parts[1];
      final identity = parts.sublist(2).join(':');
      return [
        flagsKey(identity),
        variantsKey(identity),
        revisionKey(appKey, environment, identity),
      ];
    }
    return [logicalKey];
  }

  Future<void> _touch(String logicalKey) async {
    if (!_enabled) {
      return;
    }
    await _runSerializedIndexMutation(() async {
      try {
        var index = await _loadIndex();
        index = touchCacheLruKey(index, logicalKey, now: _nowMs());
        await _saveIndex(index);
      } catch (_) {
        // Swallow.
      }
    });
  }

  Future<void> _touchAndMaybeEvict(String logicalKey) async {
    if (!_enabled) {
      return;
    }
    await _runSerializedIndexMutation(() async {
      try {
        var index = await _loadIndex();
        index = touchCacheLruKey(index, logicalKey, now: _nowMs());
        await _saveIndex(index);

        final toEvict = selectCacheLruKeysToEvict(
          index,
          maxCacheKeys,
          protectKeys: _protectKeysForLogicalKey(logicalKey),
        );
        if (toEvict.isEmpty) {
          return;
        }

        for (final key in toEvict) {
          await _evictLogicalKey(key);
        }
        index = removeCacheLruKeys(index, toEvict);
        await _saveIndex(index);
      } catch (_) {
        // Swallow.
      }
    });
  }

  Future<void> _removeFromIndex(String logicalKey) async {
    if (!_enabled) {
      return;
    }
    await _runSerializedIndexMutation(() async {
      try {
        var index = await _loadIndex();
        if (!index.entries.containsKey(logicalKey)) {
          return;
        }
        index = removeCacheLruKeys(index, [logicalKey]);
        await _saveIndex(index);
      } catch (_) {
        // Swallow.
      }
    });
  }

  Future<void> _evictLogicalKey(String logicalKey) async {
    if (logicalKey.startsWith('flags:')) {
      await _inner.deleteFlags(logicalKey.substring('flags:'.length));
      return;
    }
    if (logicalKey.startsWith('variants:')) {
      await _inner.deleteVariants(logicalKey.substring('variants:'.length));
      return;
    }
    if (logicalKey.startsWith('revision:')) {
      final rest = logicalKey.substring('revision:'.length);
      final parts = rest.split(':');
      if (parts.length < 3) {
        return;
      }
      final appKey = parts[0];
      final environment = parts[1];
      final identity = parts.sublist(2).join(':');
      final revisionInner = _inner;
      if (revisionInner is TogglyRevisionCacheProvider) {
        await revisionInner.deleteDefinitionsRevision(
          appKey,
          environment,
          identity,
        );
      }
    }
  }

  static String flagsKey(String identity) => 'flags:$identity';
  static String variantsKey(String identity) => 'variants:$identity';
  static String revisionKey(
    String appKey,
    String environment,
    String identity,
  ) =>
      'revision:$appKey:$environment:$identity';

  @override
  Future<TogglyFeatureFlagsCache?> readFlags(String identity) async {
    final value = await _inner.readFlags(identity);
    if (value != null) {
      await _touch(flagsKey(identity));
    }
    return value;
  }

  @override
  Future<void> writeFlags(TogglyFeatureFlagsCache cache) async {
    await _inner.writeFlags(cache);
    await _touchAndMaybeEvict(flagsKey(cache.identity));
  }

  @override
  Future<void> deleteFlags(String identity) async {
    await _inner.deleteFlags(identity);
    await _removeFromIndex(flagsKey(identity));
  }

  @override
  Future<TogglyVariantsCache?> readVariants(String identity) async {
    final value = await _inner.readVariants(identity);
    if (value != null) {
      await _touch(variantsKey(identity));
    }
    return value;
  }

  @override
  Future<void> writeVariants(TogglyVariantsCache cache) async {
    await _inner.writeVariants(cache);
    await _touchAndMaybeEvict(variantsKey(cache.identity));
  }

  @override
  Future<void> deleteVariants(String identity) async {
    await _inner.deleteVariants(identity);
    await _removeFromIndex(variantsKey(identity));
  }

  @override
  Future<String?> readJwks() => _inner.readJwks();

  @override
  Future<void> writeJwks(String jwks) => _inner.writeJwks(jwks);

  @override
  Future<void> deleteJwks() => _inner.deleteJwks();

  @override
  Future<String?> readCacheLruIndex() => _inner.readCacheLruIndex();

  @override
  Future<void> writeCacheLruIndex(String json) =>
      _inner.writeCacheLruIndex(json);
}

class _LruRevisionTogglyCacheProvider extends LruTogglyCacheProvider
    implements TogglyRevisionCacheProvider {
  _LruRevisionTogglyCacheProvider(
    TogglyRevisionCacheProvider inner, {
    required int maxCacheKeys,
    int Function()? nowMs,
  }) : super._(inner, maxCacheKeys: maxCacheKeys, nowMs: nowMs);

  TogglyRevisionCacheProvider get _revisionInner =>
      _inner as TogglyRevisionCacheProvider;

  @override
  Future<String?> readDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
  ) async {
    final value = await _revisionInner.readDefinitionsRevision(
      appKey,
      environment,
      identity,
    );
    if (value != null) {
      await _touch(LruTogglyCacheProvider.revisionKey(
        appKey,
        environment,
        identity,
      ));
    }
    return value;
  }

  @override
  Future<void> writeDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
    String revision,
  ) async {
    await _revisionInner.writeDefinitionsRevision(
      appKey,
      environment,
      identity,
      revision,
    );
    await _touchAndMaybeEvict(LruTogglyCacheProvider.revisionKey(
      appKey,
      environment,
      identity,
    ));
  }

  @override
  Future<void> deleteDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
  ) async {
    await _revisionInner.deleteDefinitionsRevision(
      appKey,
      environment,
      identity,
    );
    await _removeFromIndex(LruTogglyCacheProvider.revisionKey(
      appKey,
      environment,
      identity,
    ));
  }
}
