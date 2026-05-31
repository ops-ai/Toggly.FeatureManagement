import 'dart:io';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:feature_flags_toggly_disk/feature_flags_toggly_disk.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/cache_provider_contract.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory tempDir;

  setUp(() {
    tempDir = Directory.systemTemp.createTempSync('toggly_disk_test');
  });

  tearDown(() {
    if (tempDir.existsSync()) {
      tempDir.deleteSync(recursive: true);
    }
  });

  group('DiskCacheProvider', () {
    runCacheProviderContract(() => DiskCacheProvider(directory: tempDir));

    test('writes a JSON file to the target directory', () async {
      final provider = DiskCacheProvider(directory: tempDir);
      await provider.writeJwks('{"keys":[]}');
      expect(File('${tempDir.path}/jwks.json').existsSync(), isTrue);
    });

    test('corrupt file is treated as a miss', () async {
      final provider = DiskCacheProvider(directory: tempDir);
      await provider.writeFlags(
        TogglyFeatureFlagsCache(
          identity: 'user-1',
          flags: '{"A":true}',
          timestamp: 1,
          signature: 's',
          keyId: 'k',
        ),
      );
      // Corrupt the underlying file.
      final files = tempDir.listSync().whereType<File>().toList();
      expect(files, isNotEmpty);
      files.first.writeAsStringSync('not-json{');

      expect(await provider.readFlags('user-1'), isNull);
    });

    test('creates the cache directory if it does not exist', () async {
      final nested = Directory('${tempDir.path}/nested/cache');
      final provider = DiskCacheProvider(directory: nested);
      await provider.writeJwks('{"keys":[]}');
      expect(nested.existsSync(), isTrue);
    });
  });
}
