import 'package:feature_flags_toggly_secure_storage/feature_flags_toggly_secure_storage.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/cache_provider_contract.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  final store = <String, String>{};

  void installMockHandler() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      final args = (call.arguments as Map?)?.cast<String, dynamic>() ??
          <String, dynamic>{};
      final key = args['key'] as String?;
      switch (call.method) {
        case 'write':
          store[key!] = args['value'] as String;
          return null;
        case 'read':
          return store[key];
        case 'delete':
          store.remove(key);
          return null;
        case 'readAll':
          return Map<String, String>.from(store);
        case 'deleteAll':
          store.clear();
          return null;
        case 'containsKey':
          return store.containsKey(key);
      }
      return null;
    });
  }

  setUp(() {
    store.clear();
    installMockHandler();
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  group('SecureStorageCacheProvider', () {
    runCacheProviderContract(() => SecureStorageCacheProvider());

    test('persists values through the secure store channel', () async {
      final provider = SecureStorageCacheProvider();
      await provider.writeJwks('{"keys":[]}');
      expect(store['toggly.jwks'], '{"keys":[]}');
    });

    test('corrupt stored payload is treated as a miss', () async {
      store['toggly.flags.user-1'] = 'not-json{';
      final provider = SecureStorageCacheProvider();
      expect(await provider.readFlags('user-1'), isNull);
    });

    test('reads a pre-v10 store fixture without changing durable keys',
        () async {
      const identity = 'stable-user';
      const revisionKey = 'toggly.revision.app:Production:stable-user';
      store.addAll({
        'toggly.flags.$identity':
            '{"identity":"stable-user","flags":"{\\"FeatureA\\":true}","timestamp":1000,"signature":"sig","keyId":"kid"}',
        'toggly.variants.$identity':
            '{"identity":"stable-user","variants":"{\\"FeatureA\\":{\\"enabled\\":true}}","timestamp":1001,"signature":"variant-sig","keyId":"variant-kid"}',
        'toggly.jwks': '{"keys":[]}',
        'toggly.cache-lru': '["stable-user"]',
        revisionKey: 'rev-1',
        'host.unrelated': 'retain-me',
      });

      final provider = SecureStorageCacheProvider();

      final flags = await provider.readFlags(identity);
      final variants = await provider.readVariants(identity);
      expect(flags?.flags, '{"FeatureA":true}');
      expect(flags?.signature, 'sig');
      expect(flags?.timestamp, 1000);
      expect(flags?.keyId, 'kid');
      expect(variants?.variants, '{"FeatureA":{"enabled":true}}');
      expect(variants?.signature, 'variant-sig');
      expect(variants?.timestamp, 1001);
      expect(variants?.keyId, 'variant-kid');
      expect(await provider.readJwks(), '{"keys":[]}');
      expect(await provider.readCacheLruIndex(), '["stable-user"]');
      expect(
        await provider.readDefinitionsRevision('app', 'Production', identity),
        'rev-1',
      );
      expect(
        store,
        containsPair('host.unrelated', 'retain-me'),
      );
      expect(
          store.keys,
          containsAll(<String>[
            'toggly.flags.$identity',
            'toggly.variants.$identity',
            'toggly.jwks',
            'toggly.cache-lru',
            revisionKey,
          ]));
    });

    test('propagates secure-store failures without clearing stored values',
        () async {
      store['toggly.jwks'] = 'existing-data';
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        throw PlatformException(
          code: 'decrypt-failed',
          message: 'Retain the encrypted store',
        );
      });

      await expectLater(
        SecureStorageCacheProvider().readJwks(),
        throwsA(
          isA<PlatformException>().having(
            (error) => error.code,
            'code',
            'decrypt-failed',
          ),
        ),
      );
      expect(store['toggly.jwks'], 'existing-data');
    });
  });

  group('definitions revision', () {
    const identityA = 'u:user-a';
    const identityB = 'u:user-b';

    test('write then read round-trips by appKey and environment', () async {
      final provider = SecureStorageCacheProvider();
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
      final provider = SecureStorageCacheProvider();
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
      final provider = SecureStorageCacheProvider();
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
      final provider = SecureStorageCacheProvider();
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
      store['toggly.revision.app-1:Production'] = 'legacy-rev';
      final provider = SecureStorageCacheProvider();

      expect(
        await provider.readDefinitionsRevision(
            'app-1', 'Production', identityA),
        'legacy-rev',
      );
      expect(store.containsKey('toggly.revision.app-1:Production'), isFalse);
      expect(
        store['toggly.revision.app-1:Production:u:user-a'],
        'legacy-rev',
      );
    });
  });
}
