import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:ecdsa/ecdsa.dart';
import 'package:elliptic/elliptic.dart';
import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// Pads [value] to 32 bytes (P-256 coordinate / half of IEEE P1363 signature).
List<int> _pad32(BigInt value) {
  final bytes = value.toRadixString(16).padLeft(64, '0');
  final out = <int>[];
  for (var i = 0; i < bytes.length; i += 2) {
    out.add(int.parse(bytes.substring(i, i + 2), radix: 16));
  }
  return out;
}

String _base64Url(List<int> bytes) =>
    base64Url.encode(bytes).replaceAll('=', '');

/// Matches Toggly.Definitions / Web Crypto ES256: SHA-256(SHA-256(payload)).
List<int> _doubleSha256(String dataToVerify) {
  final first = sha256.convert(utf8.encode(dataToVerify)).bytes;
  return sha256.convert(first).bytes;
}

class _SignedFixture {
  _SignedFixture({
    required this.rawBody,
    required this.jwks,
    required this.singleHashSignatureBase64,
  });

  final String rawBody;
  final Map<String, dynamic> jwks;
  final String singleHashSignatureBase64;
}

_SignedFixture _buildWebCryptoSignedFixture() {
  final ec = getP256();
  final priv = ec.generatePrivateKey();
  final pub = priv.publicKey;
  const defsJson = '{"PresalePhotos":true,"OrderSales":false}';
  const timestamp = 1783915396;
  final dataToVerify = '$defsJson|$timestamp';

  final xBytes = _pad32(pub.X);
  final yBytes = _pad32(pub.Y);
  final kidHash = sha1.convert([...xBytes, ...yBytes]);
  final kid =
      '${kidHash.bytes.map((b) => b.toRadixString(16).padLeft(2, '0').toUpperCase()).join()}ES256';

  final doubleHashSig = signature(priv, _doubleSha256(dataToVerify));
  final singleHashSig = signature(
    priv,
    sha256.convert(utf8.encode(dataToVerify)).bytes,
  );

  final doubleBytes = <int>[
    ..._pad32(doubleHashSig.R),
    ..._pad32(doubleHashSig.S),
  ];
  final singleBytes = <int>[
    ..._pad32(singleHashSig.R),
    ..._pad32(singleHashSig.S),
  ];

  final doubleSigB64 = base64.encode(doubleBytes);
  final rawBody =
      '{"defs":$defsJson,"signature":"$doubleSigB64","timestamp":$timestamp,"kid":"$kid"}';

  final jwks = {
    'keys': [
      {
        'kty': 'EC',
        'use': 'sig',
        'kid': kid,
        'crv': 'P-256',
        'alg': 'ES256',
        'x': _base64Url(xBytes),
        'y': _base64Url(yBytes),
      },
    ],
  };

  return _SignedFixture(
    rawBody: rawBody,
    jwks: jwks,
    singleHashSignatureBase64: base64.encode(singleBytes),
  );
}

void _installInterceptors({
  required String definitionsBody,
  required Map<String, dynamic> jwks,
}) {
  final http = HttpService.getInstance.http;
  http.interceptors
    ..clear()
    ..add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final path = options.uri.path;
          if (path.contains('/.well-known/jwks')) {
            handler.resolve(
              Response<dynamic>(
                requestOptions: options,
                data: jwks,
                statusCode: 200,
              ),
            );
            return;
          }
          if (path.contains('/evaluated-signed/')) {
            handler.resolve(
              Response<dynamic>(
                requestOptions: options,
                data: definitionsBody,
                statusCode: 200,
                headers: Headers.fromMap({
                  'etag': ['"rev-sig-1"'],
                }),
              ),
            );
            return;
          }
          handler.reject(
            DioException(
              requestOptions: options,
              error: 'unexpected path $path',
            ),
          );
        },
      ),
    );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    TestWidgetsFlutterBinding.instance
        .handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  });

  tearDown(() {
    Toggly.dispose();
    HttpService.getInstance.http.interceptors.clear();
  });

  test(
    'useSignedDefinitions accepts Web Crypto double-SHA256 signatures',
    () async {
      final fixture = _buildWebCryptoSignedFixture();
      _installInterceptors(
        definitionsBody: fixture.rawBody,
        jwks: fixture.jwks,
      );

      await Toggly.init(
        appKey: 'app-key',
        environment: 'TestFlight',
        identity: 'ApplicationUsers/1-C',
        useSignedDefinitions: true,
        flagDefaults: {'PresalePhotos': false, 'OrderSales': false},
        config: const TogglyConfig(
          baseURI: 'https://example.test',
          enableLiveUpdates: false,
          featureFlagsRefreshInterval: 3600000,
        ),
      );

      expect(Toggly.debug()['lastError'], isNull);
      expect(Toggly.debug()['lastSynced'], isNotNull);
      expect(Toggly.featureFlagsSnapshot['PresalePhotos'], true);
      expect(await Toggly.evaluateFeatureGate(['PresalePhotos']), true);
    },
  );

  test(
    'useSignedDefinitions rejects single-SHA256 signatures (production mismatch)',
    () async {
      final fixture = _buildWebCryptoSignedFixture();
      // Replace the valid double-hash signature with a single-hash one.
      final tampered = jsonDecode(fixture.rawBody) as Map<String, dynamic>;
      tampered['signature'] = fixture.singleHashSignatureBase64;
      // Keep exact defs text so only the hash mode differs.
      const defsJson = '{"PresalePhotos":true,"OrderSales":false}';
      final tamperedBody =
          '{"defs":$defsJson,"signature":"${fixture.singleHashSignatureBase64}","timestamp":${tampered['timestamp']},"kid":"${tampered['kid']}"}';

      _installInterceptors(
        definitionsBody: tamperedBody,
        jwks: fixture.jwks,
      );

      final errors = <String>[];
      await Toggly.init(
        appKey: 'app-key',
        environment: 'TestFlight',
        identity: 'ApplicationUsers/1-C',
        useSignedDefinitions: true,
        flagDefaults: {'PresalePhotos': false},
        config: TogglyConfig(
          baseURI: 'https://example.test',
          enableLiveUpdates: false,
          featureFlagsRefreshInterval: 3600000,
          onError: (message, error, stack) {
            errors.add(message);
          },
        ),
      );

      expect(Toggly.debug()['lastSynced'], isNull);
      expect(Toggly.debug()['lastError'], contains('Signature verification'));
      expect(errors, contains('Signature verification failed'));
      expect(Toggly.featureFlagsSnapshot['PresalePhotos'], false);
    },
  );

  test(
    'rejects envelopes that nest signed defs under data (top-level only)',
    () async {
      final fixture = _buildWebCryptoSignedFixture();
      // Signature covers honest top-level defs bytes. Place those bytes under
      // data.defs and put attacker-controlled top-level defs first in the
      // object — a naive indexOf("defs") would verify the nested payload
      // while applying the outer Evil map.
      const honestDefs = '{"PresalePhotos":true,"OrderSales":false}';
      final envelope = jsonDecode(fixture.rawBody) as Map<String, dynamic>;
      final nestedAttackBody =
          '{"data":{"defs":$honestDefs},"defs":{"PresalePhotos":false,"Evil":true},"signature":"${envelope['signature']}","timestamp":${envelope['timestamp']},"kid":"${envelope['kid']}"}';

      _installInterceptors(
        definitionsBody: nestedAttackBody,
        jwks: fixture.jwks,
      );

      await Toggly.init(
        appKey: 'app-key',
        environment: 'TestFlight',
        identity: 'ApplicationUsers/1-C',
        useSignedDefinitions: true,
        flagDefaults: {'PresalePhotos': false, 'Evil': false},
        config: const TogglyConfig(
          baseURI: 'https://example.test',
          enableLiveUpdates: false,
          featureFlagsRefreshInterval: 3600000,
        ),
      );

      expect(Toggly.debug()['lastSynced'], isNull);
      expect(Toggly.featureFlagsSnapshot['PresalePhotos'], false);
      expect(Toggly.featureFlagsSnapshot['Evil'], false);
    },
  );

  test('debug() masks appKey', () async {
    await Toggly.init(
      appKey: 'abcdefghijklmnop',
      environment: 'Production',
      useSignedDefinitions: false,
      flagDefaults: const {},
      config: const TogglyConfig(
        baseURI: 'https://example.test',
        enableLiveUpdates: false,
      ),
    );

    expect(Toggly.debug()['appKey'], '***klmnop');
  });
}
