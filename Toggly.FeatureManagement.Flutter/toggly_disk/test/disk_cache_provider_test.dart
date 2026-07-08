import 'dart:convert';
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

  group('definitions revision', () {
    const identityA = 'u:user-a';
    const identityB = 'u:user-b';

    test('write then read round-trips by appKey and environment', () async {
      final provider = DiskCacheProvider(directory: tempDir);
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
      final provider = DiskCacheProvider(directory: tempDir);
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
      final provider = DiskCacheProvider(directory: tempDir);
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
      final provider = DiskCacheProvider(directory: tempDir);
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

    test('migrates legacy appKey/environment revision files on read', () async {
      final provider = DiskCacheProvider(directory: tempDir);
      final legacyToken = base64Url.encode(utf8.encode('app-1:Production'));
      final legacyFile = File('${tempDir.path}/revision_$legacyToken.txt');
      await legacyFile.writeAsString('legacy-rev');

      expect(
        await provider.readDefinitionsRevision(
          'app-1',
          'Production',
          identityA,
        ),
        'legacy-rev',
      );
      expect(legacyFile.existsSync(), isFalse);

      final scopedToken =
          base64Url.encode(utf8.encode('app-1:Production:u:user-a'));
      expect(
        File('${tempDir.path}/revision_$scopedToken.txt').readAsStringSync(),
        'legacy-rev',
      );
    });
  });
}
