import 'package:dio/dio.dart';
import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// Contract tests: mocked HTTP bodies match the Toggly evaluated-signed API
/// shapes, and public entry points (`isFeatureOn` / `evaluateFeatureGate`)
/// reflect real evaluation — not build-only checks.
///
/// Flutter consumes server-evaluated `defs` (not client-side filter models),
/// so shared `docs/filter-parity/fixtures` are not applicable here.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<RequestOptions> requests;

  setUp(() {
    requests = <RequestOptions>[];
    TestWidgetsFlutterBinding.instance
        .handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  });

  tearDown(() {
    Toggly.dispose();
    HttpService.getInstance.http.interceptors.clear();
  });

  void installDefsInterceptor(Map<String, dynamic> defs) {
    final http = HttpService.getInstance.http;
    http.interceptors
      ..clear()
      ..add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            requests.add(options);
            final path = options.uri.path;
            if (path.contains('/evaluated-signed/')) {
              handler.resolve(
                Response<dynamic>(
                  requestOptions: options,
                  data: {
                    'defs': defs,
                    'signature': '',
                    'timestamp': DateTime.now().millisecondsSinceEpoch ~/ 1000,
                    'kid': '',
                  },
                  statusCode: 200,
                  headers: Headers.fromMap({
                    'etag': ['"api-contract-rev-1"'],
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

  Future<void> initClient({
    String identity = 'user-1',
    List<String>? groups,
    Map<String, String>? claims,
  }) {
    return Toggly.init(
      appKey: 'app-key',
      environment: 'Production',
      identity: identity,
      groups: groups,
      claims: claims,
      useSignedDefinitions: false,
      flagDefaults: const {
        'feature-on': false,
        'feature-off': true,
        'missing': true,
        'checkout': false,
        'gated': false,
      },
      config: const TogglyConfig(
        enableTelemetry: false,
        baseURI: 'https://example.test',
        enableLiveUpdates: false,
        featureFlagsRefreshInterval: 3600000,
      ),
    );
  }

  group('remote rail (evaluated-signed)', () {
    test('GETs evaluated-signed and evaluates a defs map envelope', () async {
      installDefsInterceptor({
        'feature-on': true,
        'feature-off': false,
      });

      await initClient(
        identity: 'user-1',
        groups: const ['beta'],
        claims: const {'plan': 'pro'},
      );

      expect(requests, isNotEmpty);
      final first = requests.first;
      expect(first.uri.path, '/evaluated-signed/app-key/Production');
      // Prefer structured query params over raw encoded strings.
      final params = first.uri.queryParametersAll;
      expect(params['u'], ['user-1']);
      expect(params['g'], ['beta']);
      expect(params['claim.plan'], ['pro']);

      expect(await Toggly.isFeatureOn('feature-on'), isTrue);
      expect(await Toggly.isFeatureOn('feature-off'), isFalse);
      // Missing keys fail closed through the public evaluator.
      expect(await Toggly.isFeatureOn('missing'), isFalse);
      expect(
        await Toggly.evaluateFeatureGate(['feature-on', 'feature-off']),
        isFalse,
      );
      expect(
        await Toggly.evaluateFeatureGate(
          ['feature-on', 'feature-off'],
          requirement: FeatureRequirement.any,
        ),
        isTrue,
      );
    });

    test('evaluates entity-gate objects inside defs via public API', () async {
      installDefsInterceptor({
        'checkout': true,
        'gated': {
          'requirement': 'all',
          'rules': [
            {
              'property': 'Color',
              'op': 'eq',
              'value': 'red',
            },
          ],
        },
      });

      await initClient(identity: 'alice');

      expect(await Toggly.isFeatureOn('checkout'), isTrue);
      expect(await Toggly.isFeatureOn('gated'), isFalse);
      expect(
        await Toggly.isFeatureOn(
          'gated',
          context: const TogglyEntityContext(
            kind: 'Order',
            key: '1',
            attributes: {'Color': 'red'},
          ),
        ),
        isTrue,
      );
      expect(
        await Toggly.isFeatureOn(
          'gated',
          context: const TogglyEntityContext(
            kind: 'Order',
            key: '2',
            attributes: {'Color': 'blue'},
          ),
        ),
        isFalse,
      );
    });
  });
}
