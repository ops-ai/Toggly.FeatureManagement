import 'dart:convert';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeCacheProvider implements TogglyRevisionCacheProvider {
  final Map<String, TogglyFeatureFlagsCache> flags = {};
  final Map<String, TogglyVariantsCache> variants = {};
  final Map<String, String> revisions = {};
  String? jwks;
  String? lruIndex;
  bool failLruReads = false;
  bool failLruWrites = false;

  @override
  Future<TogglyFeatureFlagsCache?> readFlags(String identity) async =>
      flags[identity];

  @override
  Future<void> writeFlags(TogglyFeatureFlagsCache cache) async {
    flags[cache.identity] = cache;
  }

  @override
  Future<void> deleteFlags(String identity) async {
    flags.remove(identity);
  }

  @override
  Future<TogglyVariantsCache?> readVariants(String identity) async =>
      variants[identity];

  @override
  Future<void> writeVariants(TogglyVariantsCache cache) async {
    variants[cache.identity] = cache;
  }

  @override
  Future<void> deleteVariants(String identity) async {
    variants.remove(identity);
  }

  @override
  Future<String?> readJwks() async => jwks;

  @override
  Future<void> writeJwks(String jwks) async {
    this.jwks = jwks;
  }

  @override
  Future<void> deleteJwks() async {
    jwks = null;
  }

  @override
  Future<String?> readDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
  ) async =>
      revisions['$appKey:$environment:$identity'];

  @override
  Future<void> writeDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
    String revision,
  ) async {
    revisions['$appKey:$environment:$identity'] = revision;
  }

  @override
  Future<void> deleteDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
  ) async {
    revisions.remove('$appKey:$environment:$identity');
  }

  @override
  Future<String?> readCacheLruIndex() async {
    if (failLruReads) throw StateError('lru read failed');
    return lruIndex;
  }

  @override
  Future<void> writeCacheLruIndex(String json) async {
    if (failLruWrites) throw StateError('lru write failed');
    lruIndex = json;
  }
}

TogglyFeatureFlagsCache _flags(String identity) => TogglyFeatureFlagsCache(
      identity: identity,
      flags: '{"A":true}',
      timestamp: 1,
      signature: 'sig',
      keyId: 'kid',
    );

TogglyVariantsCache _variants(String identity) => TogglyVariantsCache(
      identity: identity,
      variants: '{"A":{}}',
      timestamp: 1,
      signature: 'sig',
      keyId: 'kid',
    );

void main() {
  group('cache_lru helpers', () {
    test('parseCacheLruIndex treats corrupt JSON as empty', () {
      expect(parseCacheLruIndex('not-json').entries, isEmpty);
      expect(parseCacheLruIndex(null).entries, isEmpty);
      expect(parseCacheLruIndex('{"entries":null}').entries, isEmpty);
    });

    test('touch and select oldest for eviction', () {
      var index = emptyCacheLruIndex();
      index = touchCacheLruKey(index, 'a', now: 1);
      index = touchCacheLruKey(index, 'b', now: 2);
      index = touchCacheLruKey(index, 'c', now: 3);
      expect(selectCacheLruKeysToEvict(index, 2), ['a']);
      index = touchCacheLruKey(index, 'a', now: 4);
      expect(
        selectCacheLruKeysToEvict(index, 2, protectKey: 'c'),
        ['b'],
      );
      expect(
        selectCacheLruKeysToEvict(
          index,
          2,
          protectKeys: ['a', 'c'],
        ),
        ['b'],
      );
    });

    test('removeCacheLruKeys drops entries', () {
      var index = touchCacheLruKey(emptyCacheLruIndex(), 'a', now: 1);
      index = removeCacheLruKeys(index, ['a']);
      expect(index.entries.containsKey('a'), isFalse);
    });

    test('isCacheLruEnabled requires positive max', () {
      expect(isCacheLruEnabled(null), isFalse);
      expect(isCacheLruEnabled(0), isFalse);
      expect(isCacheLruEnabled(-1), isFalse);
      expect(isCacheLruEnabled(2), isTrue);
    });
  });

  group('LruTogglyCacheProvider', () {
    late _FakeCacheProvider inner;
    late int clock;

    setUp(() {
      inner = _FakeCacheProvider();
      clock = 1000;
    });

    LruTogglyCacheProvider wrap({int maxCacheKeys = 2}) {
      return LruTogglyCacheProvider(
        inner,
        maxCacheKeys: maxCacheKeys,
        nowMs: () => clock,
      );
    }

    test('unlimited maxCacheKeys retains all entries', () async {
      final provider = wrap(maxCacheKeys: 0);
      await provider.writeFlags(_flags('u1'));
      await provider.writeFlags(_flags('u2'));
      await provider.writeFlags(_flags('u3'));
      expect(inner.flags.keys, containsAll(['u1', 'u2', 'u3']));
      expect(inner.lruIndex, isNull);
    });

    test('evicts oldest by lastAccessed when over maxCacheKeys', () async {
      final provider = wrap(maxCacheKeys: 2);
      clock = 1;
      await provider.writeFlags(_flags('u1'));
      clock = 2;
      await provider.writeFlags(_flags('u2'));
      clock = 3;
      await provider.writeFlags(_flags('u3'));

      expect(inner.flags.containsKey('u1'), isFalse);
      expect(inner.flags.containsKey('u2'), isTrue);
      expect(inner.flags.containsKey('u3'), isTrue);

      final index = parseCacheLruIndex(inner.lruIndex);
      expect(index.entries.keys, containsAll(['flags:u2', 'flags:u3']));
      expect(index.entries.containsKey('flags:u1'), isFalse);
    });

    test('read bumps lastAccessed so hot keys survive', () async {
      final provider = wrap(maxCacheKeys: 2);
      clock = 1;
      await provider.writeFlags(_flags('u1'));
      clock = 2;
      await provider.writeFlags(_flags('u2'));
      clock = 3;
      await provider.readFlags('u1');
      clock = 4;
      await provider.writeFlags(_flags('u3'));

      expect(inner.flags.containsKey('u1'), isTrue);
      expect(inner.flags.containsKey('u2'), isFalse);
      expect(inner.flags.containsKey('u3'), isTrue);
    });

    test('protects the key just written from eviction', () async {
      final provider = wrap(maxCacheKeys: 1);
      clock = 1;
      await provider.writeFlags(_flags('old'));
      // Seed index so the newly written key is older than an existing entry.
      inner.lruIndex = jsonEncode({
        'entries': {
          'flags:hot': {'lastAccessed': 999},
          'flags:old': {'lastAccessed': 1},
        },
      });
      inner.flags['hot'] = _flags('hot');
      clock = 2;
      await provider.writeFlags(_flags('new'));

      expect(inner.flags.containsKey('new'), isTrue);
      expect(inner.flags.containsKey('hot'), isFalse);
      expect(inner.flags.containsKey('old'), isFalse);
    });

    test(
      'flags and variants siblings for same identity survive eviction',
      () async {
        final provider = wrap(maxCacheKeys: 2);
        clock = 1;
        await provider.writeFlags(_flags('u1'));
        clock = 2;
        await provider.writeFlags(_flags('u2'));
        clock = 3;
        await provider.writeVariants(_variants('u1'));

        expect(inner.flags.containsKey('u1'), isTrue);
        expect(inner.flags.containsKey('u2'), isFalse);
        expect(inner.variants.containsKey('u1'), isTrue);
        expect(inner.variants.containsKey('u2'), isFalse);

        final index = parseCacheLruIndex(inner.lruIndex);
        expect(
          index.entries.keys,
          containsAll(['flags:u1', 'variants:u1']),
        );
        expect(index.entries.containsKey('flags:u2'), isFalse);
      },
    );

    test('JWKS is never tracked or counted', () async {
      final provider = wrap(maxCacheKeys: 1);
      clock = 1;
      await provider.writeJwks('{"keys":[]}');
      clock = 2;
      await provider.writeFlags(_flags('u1'));
      clock = 3;
      await provider.writeFlags(_flags('u2'));

      expect(inner.jwks, '{"keys":[]}');
      expect(await provider.readJwks(), '{"keys":[]}');
      expect(inner.flags.containsKey('u1'), isFalse);
      expect(inner.flags.containsKey('u2'), isTrue);

      final index = parseCacheLruIndex(inner.lruIndex);
      expect(index.entries.keys, ['flags:u2']);
    });

    test('delete removes matching index entry', () async {
      final provider = wrap(maxCacheKeys: 5) as TogglyRevisionCacheProvider;
      clock = 1;
      await provider.writeFlags(_flags('u1'));
      await provider.writeVariants(_variants('u1'));
      await provider.writeDefinitionsRevision('app', 'Production', 'u1', 'rev-1');

      await provider.deleteFlags('u1');
      await provider.deleteVariants('u1');
      await provider.deleteDefinitionsRevision('app', 'Production', 'u1');

      final index = parseCacheLruIndex(inner.lruIndex);
      expect(index.entries, isEmpty);
      expect(inner.flags, isEmpty);
      expect(inner.variants, isEmpty);
      expect(inner.revisions, isEmpty);
    });

    test('implements TogglyRevisionCacheProvider when inner does', () {
      final provider = wrap();
      expect(provider, isA<TogglyRevisionCacheProvider>());
    });

    test('index I/O failures are swallowed', () async {
      final provider = wrap(maxCacheKeys: 1);
      inner.failLruReads = true;
      await provider.writeFlags(_flags('u1'));
      expect(inner.flags.containsKey('u1'), isTrue);

      inner.failLruReads = false;
      inner.failLruWrites = true;
      await provider.writeFlags(_flags('u2'));
      expect(inner.flags.containsKey('u2'), isTrue);
    });

    test('persists index JSON matching JS shape', () async {
      final provider = wrap(maxCacheKeys: 5);
      clock = 1710000000000;
      await provider.writeFlags(_flags('u:user-1|g:|c:'));

      expect(
        inner.lruIndex,
        '{"entries":{"flags:u:user-1|g:|c:":{"lastAccessed":1710000000000}}}',
      );
    });
  });
}
