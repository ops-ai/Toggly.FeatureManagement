import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:ecdsa/ecdsa.dart';
import 'package:elliptic/elliptic.dart';
import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _MemoryCacheProvider implements TogglyCacheProvider {
  final Map<String, TogglyFeatureFlagsCache> flags = {};
  String? jwks;
  int deletedFlags = 0;

  @override
  Future<TogglyFeatureFlagsCache?> readFlags(String identity) async =>
      flags[identity];

  @override
  Future<void> writeFlags(TogglyFeatureFlagsCache cache) async {
    flags[cache.identity] = cache;
  }

  @override
  Future<void> deleteFlags(String identity) async {
    deletedFlags++;
    flags.remove(identity);
  }

  @override
  Future<TogglyVariantsCache?> readVariants(String identity) async => null;

  @override
  Future<void> writeVariants(TogglyVariantsCache cache) async {}

  @override
  Future<void> deleteVariants(String identity) async {}

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
  Future<String?> readCacheLruIndex() async => null;

  @override
  Future<void> writeCacheLruIndex(String json) async {}
}

class _MemoryRevisionCacheProvider extends _MemoryCacheProvider
    implements TogglyRevisionCacheProvider {
  final Map<String, String> revisions = {};
  final Map<String, TogglyVariantsCache> variants = {};
  int deletedRevisions = 0;

  String _revisionKey(String appKey, String environment, String identity) =>
      '$appKey:$environment:$identity';

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
  Future<String?> readDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
  ) async =>
      revisions[_revisionKey(appKey, environment, identity)];

  @override
  Future<void> writeDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
    String revision,
  ) async {
    revisions[_revisionKey(appKey, environment, identity)] = revision;
  }

  @override
  Future<void> deleteDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
  ) async {
    deletedRevisions++;
    revisions.remove(_revisionKey(appKey, environment, identity));
  }
}

InterceptorsWrapper _signedFlagsInterceptor({
  required Map<String, dynamic> flagsBody,
  Map<String, dynamic>? variantsBody,
  Map<String, List<String>>? headers,
}) {
  return InterceptorsWrapper(
    onRequest: (options, handler) {
      final body = options.path.contains('/evaluated-variants-signed/')
          ? (variantsBody ?? flagsBody)
          : flagsBody;

      handler.resolve(
        Response<dynamic>(
          requestOptions: options,
          data: body,
          statusCode: 200,
          headers: headers != null ? Headers.fromMap(headers) : null,
        ),
      );
    },
  );
}

InterceptorsWrapper _notModifiedInterceptor() {
  return InterceptorsWrapper(
    onRequest: (options, handler) {
      handler.reject(
        DioException(
          requestOptions: options,
          response: Response<dynamic>(
            requestOptions: options,
            statusCode: 304,
          ),
          type: DioExceptionType.badResponse,
        ),
      );
    },
  );
}

String _b64(List<int> bytes) => base64UrlEncode(bytes).replaceAll('=', '');

Map<String, dynamic> _jwks(String keyId) {
  final x = _b64(List<int>.filled(32, 1));
  final y = _b64(List<int>.filled(32, 2));
  final xBytes = base64Url.decode(base64Url.normalize(x));
  final yBytes = base64Url.decode(base64Url.normalize(y));
  final kidInput = [...xBytes, ...yBytes];
  final computedKid =
      '${sha1.convert(kidInput).bytes.map((b) => b.toRadixString(16).padLeft(2, '0').toUpperCase()).join()}ES256';

  return {
    'keys': [
      {
        'kid': keyId == 'computed' ? computedKid : keyId,
        'x': x,
        'y': y,
      }
    ],
  };
}

List<int> _pad32(BigInt value) {
  final bytes = value.toRadixString(16).padLeft(64, '0');
  final out = <int>[];
  for (var i = 0; i < bytes.length; i += 2) {
    out.add(int.parse(bytes.substring(i, i + 2), radix: 16));
  }
  return out;
}

class _SignedFlagsFixture {
  _SignedFlagsFixture({
    required this.defsJson,
    required this.rawBody,
    required this.signature,
    required this.kid,
    required this.timestamp,
    required this.jwks,
  });

  final String defsJson;
  final String rawBody;
  final String signature;
  final String kid;
  final int timestamp;
  final Map<String, dynamic> jwks;
}

/// Valid Web Crypto double-SHA256 signed envelope for reliability tests.
_SignedFlagsFixture _buildSignedFlagsFixture({
  String defsJson = '{"FeatureA":true}',
  int timestamp = 200,
}) {
  final ec = getP256();
  final priv = ec.generatePrivateKey();
  final pub = priv.publicKey;
  final dataToVerify = '$defsJson|$timestamp';
  final first = sha256.convert(utf8.encode(dataToVerify)).bytes;
  final digest = sha256.convert(first).bytes;
  final sig = signature(priv, digest);
  final sigBytes = <int>[..._pad32(sig.R), ..._pad32(sig.S)];
  final signatureB64 = base64.encode(sigBytes);

  final xBytes = _pad32(pub.X);
  final yBytes = _pad32(pub.Y);
  final kidHash = sha1.convert([...xBytes, ...yBytes]);
  final kid =
      '${kidHash.bytes.map((b) => b.toRadixString(16).padLeft(2, '0').toUpperCase()).join()}ES256';

  final rawBody =
      '{"defs":$defsJson,"signature":"$signatureB64","timestamp":$timestamp,"kid":"$kid"}';
  final jwks = {
    'keys': [
      {
        'kty': 'EC',
        'use': 'sig',
        'kid': kid,
        'crv': 'P-256',
        'alg': 'ES256',
        'x': _b64(xBytes),
        'y': _b64(yBytes),
      },
    ],
  };

  return _SignedFlagsFixture(
    defsJson: defsJson,
    rawBody: rawBody,
    signature: signatureB64,
    kid: kid,
    timestamp: timestamp,
    jwks: jwks,
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    HttpService.getInstance.http.interceptors.clear();
  });

  tearDown(() {
    Toggly.dispose();
    HttpService.getInstance.http.interceptors.clear();
  });

  test('reports JWK fetch failure while preserving cached flags', () async {
    final provider = _MemoryCacheProvider();
    final errors = <String>[];
    final interceptor = InterceptorsWrapper(
      onRequest: (options, handler) {
        handler.reject(
          DioException(
            requestOptions: options,
            error: 'jwks unavailable',
          ),
        );
      },
    );
    HttpService.getInstance.http.interceptors.add(interceptor);

    provider.flags['u:user-1'] = TogglyFeatureFlagsCache(
      identity: 'u:user-1',
      flags: '{"FeatureA":true}',
      timestamp: 100,
      signature: 'bad-signature',
      keyId: 'kid-1',
    );

    await Toggly.init(
      appKey: 'app',
      identity: 'user-1',
      useSignedDefinitions: true,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        cacheProvider: provider,
        onError: (message, error, stackTrace) => errors.add(message),
      ),
    );

    final flags = await Toggly.cachedFeatureFlags;

    expect(flags['FeatureA'], true);
    expect(provider.deletedFlags, 0);
    expect(errors, contains('Error fetching JWKs'));

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  test('clears cache when persisted signature verification fails', () async {
    final provider = _MemoryCacheProvider();
    final errors = <String>[];
    // Valid curve points + kid, but a zeroed signature so ECDSA returns false
    // (not a SchnorrException that soft-keeps last-known-good).
    final fixture = _buildSignedFlagsFixture(timestamp: 100);
    final interceptor = InterceptorsWrapper(
      onRequest: (options, handler) {
        handler.resolve(
          Response<dynamic>(
            requestOptions: options,
            data: fixture.jwks,
            statusCode: 200,
          ),
        );
      },
    );
    HttpService.getInstance.http.interceptors.add(interceptor);

    provider.flags['u:user-1'] = TogglyFeatureFlagsCache(
      identity: 'u:user-1',
      flags: fixture.defsJson,
      timestamp: fixture.timestamp,
      signature: base64Encode(List<int>.filled(64, 0)),
      keyId: fixture.kid,
    );

    await Toggly.init(
      identity: 'user-1',
      useSignedDefinitions: true,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        cacheProvider: provider,
        onError: (message, error, stackTrace) => errors.add(message),
      ),
    );

    final flags = await Toggly.cachedFeatureFlags;

    expect(flags['FeatureA'], false);
    expect(provider.deletedFlags, greaterThan(0));
    expect(errors, contains('Signature verification failed'));

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  test('clears cache and reports error when fresh signature verification fails',
      () async {
    final provider = _MemoryCacheProvider();
    final errors = <String>[];
    final jwks = _jwks('computed');
    final computedKeyId = (jwks['keys'] as List).first['kid'] as String;
    final interceptor = InterceptorsWrapper(
      onRequest: (options, handler) {
        if (options.path.endsWith('/.well-known/jwks')) {
          handler.resolve(
            Response<dynamic>(
              requestOptions: options,
              data: jwks,
              statusCode: 200,
            ),
          );
          return;
        }

        handler.resolve(
          Response<dynamic>(
            requestOptions: options,
            data: {
              'defs': {'FeatureA': true},
              'signature': base64Encode(List<int>.filled(64, 0)),
              'timestamp': 200,
              'kid': computedKeyId,
            },
            statusCode: 200,
          ),
        );
      },
    );
    HttpService.getInstance.http.interceptors.add(interceptor);

    provider.flags['u:user-1'] = TogglyFeatureFlagsCache(
      identity: 'u:user-1',
      flags: '{"FeatureA":false}',
      timestamp: 100,
      signature: base64Encode(List<int>.filled(64, 1)),
      keyId: computedKeyId,
    );

    final result = await Toggly.init(
      appKey: 'app',
      identity: 'user-1',
      useSignedDefinitions: true,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        cacheProvider: provider,
        onError: (message, error, stackTrace) => errors.add(message),
      ),
    );

    expect(result.status, TogglyLoadFeatureFlagsResponse.error);
    expect(provider.deletedFlags, greaterThan(0));
    expect(errors, contains('Signature verification failed'));

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  test('equal-timestamp re-fetch keeps flags instead of wiping to defaults',
      () async {
    final provider = _MemoryCacheProvider();
    final errors = <String>[];
    // Toggly's signed `timestamp` is the definitions publish time — it stays
    // constant across fetches of unchanged definitions. A re-fetch that
    // returns the same timestamp must NOT be treated as a rollback.
    final fixture = _buildSignedFlagsFixture();
    final interceptor = InterceptorsWrapper(
      onRequest: (options, handler) {
        if (options.path.endsWith('/.well-known/jwks')) {
          handler.resolve(
            Response<dynamic>(
              requestOptions: options,
              data: fixture.jwks,
              statusCode: 200,
            ),
          );
          return;
        }
        handler.resolve(
          Response<dynamic>(
            requestOptions: options,
            data: fixture.rawBody,
            statusCode: 200,
          ),
        );
      },
    );
    HttpService.getInstance.http.interceptors.add(interceptor);

    provider.flags['u:user-1'] = TogglyFeatureFlagsCache(
      identity: 'u:user-1',
      flags: fixture.defsJson,
      timestamp: fixture.timestamp,
      signature: fixture.signature,
      keyId: fixture.kid,
    );

    await Toggly.init(
      appKey: 'app',
      identity: 'user-1',
      useSignedDefinitions: true,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        cacheProvider: provider,
        onError: (message, error, stackTrace) => errors.add(message),
      ),
    );

    final flags = await Toggly.cachedFeatureFlags;

    expect(flags['FeatureA'], true);
    expect(provider.deletedFlags, 0);

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  test('rollback (older timestamp) keeps newer cached flags, no cache delete',
      () async {
    final provider = _MemoryCacheProvider();
    final errors = <String>[];
    final interceptor = InterceptorsWrapper(
      onRequest: (options, handler) {
        handler.resolve(
          Response<dynamic>(
            requestOptions: options,
            data: {
              'defs': {'FeatureA': false},
              'signature': base64Encode(List<int>.filled(64, 0)),
              'timestamp': 100,
              'kid': 'kid-1',
            },
            statusCode: 200,
          ),
        );
      },
    );
    HttpService.getInstance.http.interceptors.add(interceptor);

    provider.flags['u:user-1'] = TogglyFeatureFlagsCache(
      identity: 'u:user-1',
      flags: '{"FeatureA":true}',
      timestamp: 300,
      signature: base64Encode(List<int>.filled(64, 0)),
      keyId: 'kid-1',
    );

    final result = await Toggly.init(
      appKey: 'app',
      identity: 'user-1',
      useSignedDefinitions: true,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        cacheProvider: provider,
        onError: (message, error, stackTrace) => errors.add(message),
      ),
    );

    final flags = await Toggly.cachedFeatureFlags;

    expect(result.status, TogglyLoadFeatureFlagsResponse.cached);
    expect(flags['FeatureA'], true);
    expect(provider.deletedFlags, 0);
    expect(
      errors.any((message) => message.contains('Rejected rollback')),
      isFalse,
    );

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  test('each user sends their own persisted If-None-Match revision', () async {
    final provider = _MemoryRevisionCacheProvider();
    await provider.writeDefinitionsRevision(
      'app',
      'Production',
      'u:user-a',
      'rev-a',
    );
    await provider.writeDefinitionsRevision(
      'app',
      'Production',
      'u:user-b',
      'rev-b',
    );

    final captured = <String?>[];
    final interceptor = InterceptorsWrapper(
      onRequest: (options, handler) {
        captured.add(options.headers['If-None-Match'] as String?);
        handler.resolve(
          Response<dynamic>(
            requestOptions: options,
            data: {
              'defs': {'FeatureA': true},
              'signature': base64Encode(List<int>.filled(64, 0)),
              'timestamp': 200,
              'kid': 'kid-1',
            },
            statusCode: 200,
          ),
        );
      },
    );
    HttpService.getInstance.http.interceptors.add(interceptor);

    await Toggly.init(
      appKey: 'app',
      identity: 'user-a',
      useSignedDefinitions: false,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        cacheProvider: provider,
      ),
    );
    expect(captured.last, 'rev-a');
    expect(provider.deletedRevisions, 0);

    captured.clear();
    await Toggly.setIdentity('user-b');
    expect(captured.last, 'rev-b');
    expect(provider.deletedRevisions, 0);
    expect(provider.revisions['app:Production:u:user-a'], 'rev-a');

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  test('setIdentity switch preserves persisted flags for switch-back',
      () async {
    final provider = _MemoryRevisionCacheProvider();
    provider.flags['u:user-a'] = TogglyFeatureFlagsCache(
      identity: 'u:user-a',
      flags: '{"FeatureA":true}',
      timestamp: 200,
      signature: base64Encode(List<int>.filled(64, 0)),
      keyId: 'kid-1',
    );
    provider.flags['u:user-b'] = TogglyFeatureFlagsCache(
      identity: 'u:user-b',
      flags: '{"FeatureA":false}',
      timestamp: 200,
      signature: base64Encode(List<int>.filled(64, 0)),
      keyId: 'kid-1',
    );

    final interceptor = _notModifiedInterceptor();
    HttpService.getInstance.http.interceptors.add(interceptor);

    await Toggly.init(
      appKey: 'app',
      identity: 'user-a',
      useSignedDefinitions: true,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        cacheProvider: provider,
      ),
    );

    expect(provider.deletedFlags, 0);
    expect((await Toggly.cachedFeatureFlags)['FeatureA'], true);

    await Toggly.setIdentity('user-b');
    expect(provider.deletedFlags, 0);
    expect(provider.flags.containsKey('u:user-a'), isTrue);
    expect((await Toggly.cachedFeatureFlags)['FeatureA'], false);

    await Toggly.setIdentity('user-a');
    expect(provider.deletedFlags, 0);
    expect(provider.flags.containsKey('u:user-b'), isTrue);
    expect((await Toggly.cachedFeatureFlags)['FeatureA'], true);

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  test('setIdentity with unchanged identity returns cached without deleting',
      () async {
    final provider = _MemoryCacheProvider();
    final interceptor = _notModifiedInterceptor();
    HttpService.getInstance.http.interceptors.add(interceptor);

    provider.flags['u:user-1'] = TogglyFeatureFlagsCache(
      identity: 'u:user-1',
      flags: '{"FeatureA":true}',
      timestamp: 200,
      signature: base64Encode(List<int>.filled(64, 0)),
      keyId: 'kid-1',
    );

    await Toggly.init(
      appKey: 'app',
      identity: 'user-1',
      useSignedDefinitions: true,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        cacheProvider: provider,
      ),
    );

    final result = await Toggly.setIdentity('user-1');

    expect(result.status, TogglyLoadFeatureFlagsResponse.cached);
    expect(provider.deletedFlags, 0);

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  test('setContext preserves persisted cache when groups change', () async {
    final provider = _MemoryRevisionCacheProvider();
    provider.flags['u:user-1|g:beta'] = TogglyFeatureFlagsCache(
      identity: 'u:user-1|g:beta',
      flags: '{"FeatureA":true}',
      timestamp: 200,
      signature: base64Encode(List<int>.filled(64, 0)),
      keyId: 'kid-1',
    );

    final interceptor = _notModifiedInterceptor();
    HttpService.getInstance.http.interceptors.add(interceptor);

    await Toggly.init(
      appKey: 'app',
      identity: 'user-1',
      groups: ['beta'],
      useSignedDefinitions: true,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        cacheProvider: provider,
      ),
    );

    expect(provider.deletedFlags, 0);

    await Toggly.setContext(groups: ['enterprise']);

    expect(provider.deletedFlags, 0);
    expect(provider.flags.containsKey('u:user-1|g:beta'), isTrue);

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  test('setContext with no changes returns cached', () async {
    await Toggly.init(
      useSignedDefinitions: false,
      flagDefaults: {'FeatureA': false},
    );

    final result = await Toggly.setContext();

    expect(result.status, TogglyLoadFeatureFlagsResponse.cached);
  });

  test(
      'setIdentity(null) clears in-memory state without deleting persisted cache',
      () async {
    final provider = _MemoryRevisionCacheProvider();
    provider.flags['u:user-1'] = TogglyFeatureFlagsCache(
      identity: 'u:user-1',
      flags: '{"FeatureA":true}',
      timestamp: 200,
      signature: base64Encode(List<int>.filled(64, 0)),
      keyId: 'kid-1',
    );

    final interceptor = _notModifiedInterceptor();
    HttpService.getInstance.http.interceptors.add(interceptor);

    await Toggly.init(
      appKey: 'app',
      identity: 'user-1',
      useSignedDefinitions: false,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        cacheProvider: provider,
      ),
    );

    await Toggly.setIdentity(null);

    expect(provider.deletedFlags, 0);
    expect(provider.flags.containsKey('u:user-1'), isTrue);

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  test(
      'setContext with identity change refreshes without deleting persisted cache',
      () async {
    final provider = _MemoryRevisionCacheProvider();
    provider.flags['u:user-1'] = TogglyFeatureFlagsCache(
      identity: 'u:user-1',
      flags: '{"FeatureA":true}',
      timestamp: 200,
      signature: base64Encode(List<int>.filled(64, 0)),
      keyId: 'kid-1',
    );
    provider.flags['u:user-2'] = TogglyFeatureFlagsCache(
      identity: 'u:user-2',
      flags: '{"FeatureA":false}',
      timestamp: 200,
      signature: base64Encode(List<int>.filled(64, 0)),
      keyId: 'kid-1',
    );

    final interceptor = _notModifiedInterceptor();
    HttpService.getInstance.http.interceptors.add(interceptor);

    await Toggly.init(
      appKey: 'app',
      identity: 'user-1',
      useSignedDefinitions: false,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        cacheProvider: provider,
      ),
    );

    await Toggly.setContext(identity: 'user-2');

    expect(provider.deletedFlags, 0);
    expect(provider.flags.containsKey('u:user-1'), isTrue);
    expect(provider.flags.containsKey('u:user-2'), isTrue);

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  test('setContext with claims change preserves other persisted entries',
      () async {
    final provider = _MemoryRevisionCacheProvider();
    provider.flags['u:user-1|c:role=admin'] = TogglyFeatureFlagsCache(
      identity: 'u:user-1|c:role=admin',
      flags: '{"FeatureA":true}',
      timestamp: 200,
      signature: base64Encode(List<int>.filled(64, 0)),
      keyId: 'kid-1',
    );

    final interceptor = _notModifiedInterceptor();
    HttpService.getInstance.http.interceptors.add(interceptor);

    await Toggly.init(
      appKey: 'app',
      identity: 'user-1',
      claims: {'role': 'admin'},
      useSignedDefinitions: true,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        cacheProvider: provider,
      ),
    );

    await Toggly.setContext(claims: {'role': 'viewer'});

    expect(provider.deletedFlags, 0);
    expect(provider.flags.containsKey('u:user-1|c:role=admin'), isTrue);

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  test('clearFeatureFlagsCache deletes persisted revision for current identity',
      () async {
    final provider = _MemoryRevisionCacheProvider();
    await provider.writeDefinitionsRevision(
      'app',
      'Production',
      'u:user-1',
      'rev-1',
    );

    await Toggly.init(
      appKey: 'app',
      identity: 'user-1',
      useSignedDefinitions: false,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        cacheProvider: provider,
      ),
    );

    await Toggly.clearFeatureFlagsCache();

    expect(provider.deletedRevisions, 1);
    expect(provider.revisions['app:Production:u:user-1'], isNull);
  });

  test('fetch persists X-Definitions-Revision header', () async {
    final provider = _MemoryRevisionCacheProvider();
    final interceptor = _signedFlagsInterceptor(
      flagsBody: {
        'defs': {'FeatureA': true},
        'signature': base64Encode(List<int>.filled(64, 0)),
        'timestamp': 200,
        'kid': 'kid-1',
      },
      headers: {
        'x-definitions-revision': ['custom-rev'],
      },
    );
    HttpService.getInstance.http.interceptors.add(interceptor);

    await Toggly.init(
      appKey: 'app',
      identity: 'user-1',
      useSignedDefinitions: false,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        cacheProvider: provider,
      ),
    );

    expect(
      provider.revisions['app:Production:u:user-1'],
      'custom-rev',
    );

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  test('fetch persists definitions revision from response ETag', () async {
    final provider = _MemoryRevisionCacheProvider();
    final interceptor = _signedFlagsInterceptor(
      flagsBody: {
        'defs': {'FeatureA': true},
        'signature': base64Encode(List<int>.filled(64, 0)),
        'timestamp': 200,
        'kid': 'kid-1',
      },
      headers: {
        'etag': ['rev-from-server']
      },
    );
    HttpService.getInstance.http.interceptors.add(interceptor);

    await Toggly.init(
      appKey: 'app',
      identity: 'user-1',
      useSignedDefinitions: false,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        cacheProvider: provider,
      ),
    );

    expect(
      provider.revisions['app:Production:u:user-1'],
      'rev-from-server',
    );
    expect(Toggly.debug()['definitionsRevision'], 'rev-from-server');

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  test('variants equal-timestamp re-fetch keeps cached assignments', () async {
    final provider = _MemoryRevisionCacheProvider();
    const signedMeta = {
      'signature':
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
      'timestamp': 200,
      'kid': 'kid-1',
    };
    final interceptor = _signedFlagsInterceptor(
      flagsBody: {
        'defs': {'FeatureA': true},
        ...signedMeta,
      },
      variantsBody: {
        'defs': {
          'FeatureA': {'enabled': true, 'variant': 'v1'},
        },
        ...signedMeta,
      },
    );
    HttpService.getInstance.http.interceptors.add(interceptor);

    provider.variants['u:user-1'] = TogglyVariantsCache(
      identity: 'u:user-1',
      variants: '{"FeatureA":{"enabled":true,"variant":"v1"}}',
      timestamp: 200,
      signature: base64Encode(List<int>.filled(64, 0)),
      keyId: 'kid-1',
    );

    await Toggly.init(
      appKey: 'app',
      identity: 'user-1',
      useSignedDefinitions: false,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        enableVariants: true,
        cacheProvider: provider,
      ),
    );

    final defs = await Toggly.cachedVariantDefinitions();
    expect(defs['FeatureA'], isNotNull);
    expect((defs['FeatureA'] as Map)['variant'], 'v1');

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  test('variants rollback keeps newer cached assignments', () async {
    final provider = _MemoryRevisionCacheProvider();
    const signedMeta = {
      'signature':
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
      'timestamp': 100,
      'kid': 'kid-1',
    };
    final interceptor = _signedFlagsInterceptor(
      flagsBody: {
        'defs': {'FeatureA': true},
        'signature': base64Encode(List<int>.filled(64, 0)),
        'timestamp': 300,
        'kid': 'kid-1',
      },
      variantsBody: {
        'defs': {
          'FeatureA': {'enabled': true, 'variant': 'old'},
        },
        ...signedMeta,
      },
    );
    HttpService.getInstance.http.interceptors.add(interceptor);

    provider.variants['u:user-1'] = TogglyVariantsCache(
      identity: 'u:user-1',
      variants: '{"FeatureA":{"enabled":true,"variant":"new"}}',
      timestamp: 300,
      signature: base64Encode(List<int>.filled(64, 0)),
      keyId: 'kid-1',
    );

    await Toggly.init(
      appKey: 'app',
      identity: 'user-1',
      useSignedDefinitions: false,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        enableLiveUpdates: false,
        baseURI: 'https://example.test',
        enableVariants: true,
        cacheProvider: provider,
      ),
    );

    final defs = await Toggly.cachedVariantDefinitions();
    expect((defs['FeatureA'] as Map)['variant'], 'new');

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  testWidgets('Feature rebuilds when feature flags stream emits',
      (tester) async {
    await Toggly.init(
      useSignedDefinitions: false,
      flagDefaults: {'FeatureA': false},
    );

    await tester.pumpWidget(
      const MaterialApp(
        home: Feature(
          featureKeys: ['FeatureA'],
          child: Text('Visible feature'),
        ),
      ),
    );

    expect(find.text('Visible feature'), findsNothing);

    Toggly.cacheFeatureFlags(featureFlags: '{"FeatureA":true}');
    await tester.pump();
    await tester.pump();

    expect(find.text('Visible feature'), findsOneWidget);
  });
}
