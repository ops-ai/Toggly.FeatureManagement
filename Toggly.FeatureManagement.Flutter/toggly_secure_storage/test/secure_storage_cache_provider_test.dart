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
