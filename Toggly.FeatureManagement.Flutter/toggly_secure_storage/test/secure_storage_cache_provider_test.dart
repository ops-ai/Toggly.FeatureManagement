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
}
