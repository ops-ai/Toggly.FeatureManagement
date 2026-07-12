import 'dart:async';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter_test/flutter_test.dart';

/// Reusable conformance suite for any [TogglyCacheProvider] implementation.
///
/// This file is the single source of truth for the provider contract and is
/// copied verbatim into each `feature_flags_toggly_*` companion package's
/// `test/support/` directory. Keep the copies in sync.
///
/// [factory] must return a provider instance backed by an isolated, empty
/// store. [reset] (when provided) is awaited in `setUp`/`tearDown` to clear
/// any shared backing state between tests.
void runCacheProviderContract(
  TogglyCacheProvider Function() factory, {
  FutureOr<void> Function()? reset,
}) {
  late TogglyCacheProvider provider;

  TogglyFeatureFlagsCache flagsFor(
    String identity, {
    String flags = '{"FeatureA":true,"FeatureB":false}',
    int? timestamp = 1000,
    String? signature = 'sig-abc',
    String? keyId = 'kid-1',
  }) =>
      TogglyFeatureFlagsCache(
        identity: identity,
        flags: flags,
        timestamp: timestamp,
        signature: signature,
        keyId: keyId,
      );

  TogglyVariantsCache variantsFor(
    String identity, {
    String variants = '{"FeatureA":{"enabled":true,"variant":"v1"}}',
    int? timestamp = 2000,
    String? signature = 'sig-var',
    String? keyId = 'kid-2',
  }) =>
      TogglyVariantsCache(
        identity: identity,
        variants: variants,
        timestamp: timestamp,
        signature: signature,
        keyId: keyId,
      );

  setUp(() async {
    if (reset != null) await reset();
    provider = factory();
  });

  tearDown(() async {
    if (reset != null) await reset();
  });

  group('flags', () {
    test('read returns null when nothing stored', () async {
      expect(await provider.readFlags('user-1'), isNull);
    });

    test('write then read round-trips all fields', () async {
      await provider.writeFlags(flagsFor('user-1'));

      final read = await provider.readFlags('user-1');
      expect(read, isNotNull);
      expect(read!.identity, 'user-1');
      expect(read.flags, '{"FeatureA":true,"FeatureB":false}');
      expect(read.timestamp, 1000);
      expect(read.signature, 'sig-abc');
      expect(read.keyId, 'kid-1');
    });

    test('write preserves null signature metadata (unsigned)', () async {
      await provider.writeFlags(
        flagsFor('user-1', timestamp: null, signature: null, keyId: null),
      );

      final read = await provider.readFlags('user-1');
      expect(read, isNotNull);
      expect(read!.timestamp, isNull);
      expect(read.signature, isNull);
      expect(read.keyId, isNull);
    });

    test('overwrite returns latest value', () async {
      await provider.writeFlags(flagsFor('user-1', timestamp: 1000));
      await provider.writeFlags(
        flagsFor('user-1', flags: '{"FeatureA":false}', timestamp: 2000),
      );

      final read = await provider.readFlags('user-1');
      expect(read!.flags, '{"FeatureA":false}');
      expect(read.timestamp, 2000);
    });

    test('delete removes the entry', () async {
      await provider.writeFlags(flagsFor('user-1'));
      await provider.deleteFlags('user-1');
      expect(await provider.readFlags('user-1'), isNull);
    });

    test('delete of missing entry does not throw', () async {
      await provider.deleteFlags('does-not-exist');
      expect(await provider.readFlags('does-not-exist'), isNull);
    });

    test('different identities are isolated', () async {
      await provider.writeFlags(flagsFor('user-1', flags: '{"A":true}'));
      await provider.writeFlags(flagsFor('user-2', flags: '{"B":true}'));

      expect((await provider.readFlags('user-1'))!.flags, '{"A":true}');
      expect((await provider.readFlags('user-2'))!.flags, '{"B":true}');

      await provider.deleteFlags('user-1');
      expect(await provider.readFlags('user-1'), isNull);
      expect(await provider.readFlags('user-2'), isNotNull);
    });
  });

  group('variants', () {
    test('read returns null when nothing stored', () async {
      expect(await provider.readVariants('user-1'), isNull);
    });

    test('write then read round-trips all fields', () async {
      await provider.writeVariants(variantsFor('user-1'));

      final read = await provider.readVariants('user-1');
      expect(read, isNotNull);
      expect(read!.identity, 'user-1');
      expect(read.variants, '{"FeatureA":{"enabled":true,"variant":"v1"}}');
      expect(read.timestamp, 2000);
      expect(read.signature, 'sig-var');
      expect(read.keyId, 'kid-2');
    });

    test('overwrite returns latest value', () async {
      await provider.writeVariants(variantsFor('user-1', timestamp: 2000));
      await provider.writeVariants(
        variantsFor('user-1',
            variants: '{"X":{"enabled":false}}', timestamp: 3000),
      );

      final read = await provider.readVariants('user-1');
      expect(read!.variants, '{"X":{"enabled":false}}');
      expect(read.timestamp, 3000);
    });

    test('delete removes the entry', () async {
      await provider.writeVariants(variantsFor('user-1'));
      await provider.deleteVariants('user-1');
      expect(await provider.readVariants('user-1'), isNull);
    });

    test('different identities are isolated', () async {
      await provider.writeVariants(variantsFor('user-1', variants: '{"A":{}}'));
      await provider.writeVariants(variantsFor('user-2', variants: '{"B":{}}'));

      expect((await provider.readVariants('user-1'))!.variants, '{"A":{}}');
      expect((await provider.readVariants('user-2'))!.variants, '{"B":{}}');
    });

    test('flags and variants for same identity do not collide', () async {
      await provider.writeFlags(flagsFor('user-1', flags: '{"flag":true}'));
      await provider
          .writeVariants(variantsFor('user-1', variants: '{"variant":{}}'));

      expect((await provider.readFlags('user-1'))!.flags, '{"flag":true}');
      expect(
          (await provider.readVariants('user-1'))!.variants, '{"variant":{}}');
    });
  });

  group('jwks', () {
    test('read returns null when nothing stored', () async {
      expect(await provider.readJwks(), isNull);
    });

    test('write then read round-trips', () async {
      const jwks = '{"keys":[{"kid":"abc","x":"1","y":"2"}]}';
      await provider.writeJwks(jwks);
      expect(await provider.readJwks(), jwks);
    });

    test('overwrite returns latest value', () async {
      await provider.writeJwks('{"keys":[]}');
      await provider.writeJwks('{"keys":[{"kid":"z"}]}');
      expect(await provider.readJwks(), '{"keys":[{"kid":"z"}]}');
    });

    test('delete removes the entry', () async {
      await provider.writeJwks('{"keys":[]}');
      await provider.deleteJwks();
      expect(await provider.readJwks(), isNull);
    });
  });

  group('cache LRU index', () {
    test('read returns null when nothing stored', () async {
      expect(await provider.readCacheLruIndex(), isNull);
    });

    test('write then read round-trips JSON', () async {
      const json =
          '{"entries":{"flags:u:user-1|g:|c:":{"lastAccessed":1710000000000}}}';
      await provider.writeCacheLruIndex(json);
      expect(await provider.readCacheLruIndex(), json);
    });

    test('overwrite returns latest value', () async {
      await provider.writeCacheLruIndex('{"entries":{}}');
      await provider.writeCacheLruIndex(
        '{"entries":{"flags:a":{"lastAccessed":1}}}',
      );
      expect(
        await provider.readCacheLruIndex(),
        '{"entries":{"flags:a":{"lastAccessed":1}}}',
      );
    });
  });
}
