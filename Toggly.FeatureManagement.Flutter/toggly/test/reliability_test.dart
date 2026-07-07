import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
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

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() {
    Toggly.dispose();
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
        baseURI: 'https://example.test',
        verifySignatures: true,
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

  test('reports cached signature failure without deleting valid cache',
      () async {
    final provider = _MemoryCacheProvider();
    final errors = <String>[];
    const keyId = 'computed';
    final jwks = _jwks(keyId);
    final computedKeyId = (jwks['keys'] as List).first['kid'] as String;
    final interceptor = InterceptorsWrapper(
      onRequest: (options, handler) {
        handler.resolve(
          Response<dynamic>(
            requestOptions: options,
            data: jwks,
            statusCode: 200,
          ),
        );
      },
    );
    HttpService.getInstance.http.interceptors.add(interceptor);

    provider.flags['u:user-1'] = TogglyFeatureFlagsCache(
      identity: 'u:user-1',
      flags: '{"FeatureA":true}',
      timestamp: 100,
      signature: base64Encode(List<int>.filled(64, 0)),
      keyId: computedKeyId,
    );

    await Toggly.init(
      identity: 'user-1',
      useSignedDefinitions: true,
      flagDefaults: {'FeatureA': false},
      config: TogglyConfig(
        baseURI: 'https://example.test',
        verifySignatures: true,
        cacheProvider: provider,
        onError: (message, error, stackTrace) => errors.add(message),
      ),
    );

    final flags = await Toggly.cachedFeatureFlags;

    expect(flags['FeatureA'], true);
    expect(provider.deletedFlags, 0);
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
        baseURI: 'https://example.test',
        verifySignatures: true,
        cacheProvider: provider,
        onError: (message, error, stackTrace) => errors.add(message),
      ),
    );

    expect(result.status, TogglyLoadFeatureFlagsResponse.error);
    expect(provider.deletedFlags, greaterThan(0));
    expect(errors, contains('Signature verification failed'));

    HttpService.getInstance.http.interceptors.remove(interceptor);
  });

  testWidgets('Feature rebuilds when feature flags stream emits',
      (tester) async {
    await Toggly.init(
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
