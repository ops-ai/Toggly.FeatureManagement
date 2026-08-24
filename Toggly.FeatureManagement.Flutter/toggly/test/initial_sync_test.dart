import 'package:dio/dio.dart';
import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void _installInterceptor(Interceptor interceptor) {
  final http = HttpService.getInstance.http;
  http.interceptors
    ..clear()
    ..add(interceptor);
}

InterceptorsWrapper _unsignedFlagsInterceptor(Map<String, bool> flags) {
  return InterceptorsWrapper(
    onRequest: (options, handler) {
      handler.resolve(
        Response<dynamic>(
          requestOptions: options,
          data: {
            'defs': flags,
            'signature': '',
            'timestamp': DateTime.now().millisecondsSinceEpoch ~/ 1000,
            'kid': '',
          },
          statusCode: 200,
          headers: Headers.fromMap({
            'etag': ['"rev-1"'],
          }),
        ),
      );
    },
  );
}

InterceptorsWrapper _failingInterceptor() {
  return InterceptorsWrapper(
    onRequest: (options, handler) {
      handler.reject(
        DioException(
          requestOptions: options,
          error: 'network unavailable',
          type: DioExceptionType.connectionError,
        ),
      );
    },
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    _installInterceptor(
      _unsignedFlagsInterceptor({
        'PresalePhotos': true,
        'OrderSales': true,
      }),
    );
  });

  tearDown(() {
    SyncService.getInstance.wsConnected = false;
    SyncService.getInstance.wsReconnecting = false;
    SyncService.getInstance.onConnected = null;
    SyncService.getInstance.onSyncMessage = null;
    SyncService.getInstance.onRefreshRequested = null;
    Toggly.dispose();
    HttpService.getInstance.http.interceptors.clear();
  });

  test(
    'inactive init + unchanged sync still fetches after resume',
    () async {
      final binding = TestWidgetsFlutterBinding.instance;
      binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);

      await Toggly.init(
        appKey: 'app-key',
        environment: 'TestFlight',
        identity: 'ApplicationUsers/1-C',
        useSignedDefinitions: false,
        flagDefaults: {'PresalePhotos': false, 'OrderSales': false},
        config: const TogglyConfig(
          baseURI: 'https://example.test',
          enableLiveUpdates: false,
          featureFlagsRefreshInterval: 3600000,
        ),
      );

      expect(Toggly.debug()['lastSynced'], isNull);
      expect(Toggly.featureFlagsSnapshot['PresalePhotos'], false);

      // Unchanged sync must not suppress the initial HTTP pull.
      expect(
        shouldFetchOnSync(
          unchanged: true,
          messageEtag: 'rev-1',
          cachedRevision: null,
          hasSuccessfulSync: false,
        ),
        isTrue,
      );

      var refreshCalls = 0;
      SyncService.getInstance.onRefreshRequested =
          ({required bool forceJwksRefresh}) async {
        refreshCalls++;
        await Toggly.refresh();
      };
      SyncService.getInstance.onConnected = () {
        if (Toggly.debug()['lastSynced'] == null) {
          SyncService.getInstance.requestRefresh();
        }
      };
      SyncService.getInstance.onSyncMessage =
          ({required bool unchanged, String? etag}) async {
        if (shouldFetchOnSync(
          unchanged: unchanged,
          messageEtag: etag,
          cachedRevision: null,
          hasSuccessfulSync:
              Toggly.debug()['lastSynced'] == null ? false : true,
        )) {
          SyncService.getInstance.requestRefresh();
        }
      };

      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);

      // Connect path (before/without a useful sync payload).
      SyncService.getInstance.onConnected!();
      await Future<void>.delayed(const Duration(milliseconds: 400));

      // Sync message with unchanged:true (common after WS connect).
      SyncService.getInstance.onSyncMessage!(
        unchanged: true,
        etag: 'rev-1',
      );
      await Future<void>.delayed(const Duration(milliseconds: 400));

      expect(refreshCalls, greaterThan(0));
      expect(Toggly.debug()['lastSynced'], isNotNull);
      expect(Toggly.featureFlagsSnapshot['PresalePhotos'], true);
      expect(await Toggly.evaluateFeatureGate(['PresalePhotos']), true);
    },
  );

  test(
    'WS connected does not block first HTTP poll when never synced',
    () async {
      final binding = TestWidgetsFlutterBinding.instance;
      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);

      await Toggly.init(
        appKey: 'app-key',
        environment: 'TestFlight',
        identity: 'user-a',
        useSignedDefinitions: false,
        flagDefaults: {'PresalePhotos': false},
        config: const TogglyConfig(
          baseURI: 'https://example.test',
          enableLiveUpdates: false,
          featureFlagsRefreshInterval: 100,
        ),
      );

      expect(Toggly.debug()['lastSynced'], isNotNull);
      expect(Toggly.featureFlagsSnapshot['PresalePhotos'], true);

      // Leave lastSynced null after a failed identity refresh.
      _installInterceptor(_failingInterceptor());
      binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await Toggly.setIdentity('user-b');
      expect(Toggly.debug()['lastSynced'], isNull);
      expect(Toggly.featureFlagsSnapshot['PresalePhotos'], false);

      _installInterceptor(
        _unsignedFlagsInterceptor({'PresalePhotos': true}),
      );
      SyncService.getInstance.wsConnected = true;
      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);

      final deadline = DateTime.now().add(const Duration(seconds: 3));
      while (Toggly.debug()['lastSynced'] == null &&
          DateTime.now().isBefore(deadline)) {
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }

      expect(Toggly.debug()['lastSynced'], isNotNull);
      expect(Toggly.featureFlagsSnapshot['PresalePhotos'], true);
      expect(await Toggly.evaluateFeatureGate(['PresalePhotos']), true);
    },
  );
}
