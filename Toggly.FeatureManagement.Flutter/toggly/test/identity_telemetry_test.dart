import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late List<RequestOptions> requests;
  late HttpServer collector;
  late List<dynamic> sent;
  late TogglyConfig config;
  Completer<void>? heldResponse;
  Completer<void>? telemetryStarted;
  setUp(() async {
    HttpOverrides.global = null;
    TestWidgetsFlutterBinding.instance
        .handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    heldResponse = null;
    telemetryStarted = null;
    requests = [];
    sent = [];
    collector = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    collector.listen((r) async {
      expect(r.headers.value('origin'), isNull);
      expect(r.headers.value('cookie'), isNull);
      expect(r.headers.value('authorization'), isNull);
      final bytes = await r.fold<List<int>>([], (a, b) => a..addAll(b));
      sent.add(jsonDecode(utf8.decode(
          r.headers.value('content-encoding') == 'gzip'
              ? gzip.decode(bytes)
              : bytes)));
      if (telemetryStarted != null && !telemetryStarted!.isCompleted) {
        telemetryStarted!.complete();
      }
      await heldResponse?.future;
      r.response.statusCode = 202;
      await r.response.close();
    });
    config = TogglyConfig(
        baseURI: 'https://definitions.invalid',
        metricsBaseUrl: 'http://127.0.0.1:${collector.port}',
        enableLiveUpdates: false);
    HttpService.getInstance.http.interceptors
      ..clear()
      ..add(InterceptorsWrapper(onRequest: (r, h) {
        requests.add(r);
        h.resolve(Response(
            requestOptions: r,
            statusCode: 200,
            data: {
              'defs': {'a': true}
            },
            headers: Headers.fromMap({
              'etag': ['"${r.queryParameters['i'] ?? r.queryParameters['u']}"']
            })));
      }));
  });
  tearDown(() async {
    if (heldResponse != null && !heldResponse!.isCompleted) {
      heldResponse!.complete();
    }
    Toggly.dispose();
    HttpService.getInstance.http.interceptors.clear();
    await collector.close(force: true);
  });

  test('reinitializing app routing retains one global reporter flight',
      () async {
    heldResponse = Completer<void>();
    telemetryStarted = Completer<void>();
    await Toggly.init(
        appKey: 'first-app',
        identity: 'alice',
        useSignedDefinitions: false,
        config: config);
    Toggly.incrementCounter('old');
    final first = Toggly.flushTelemetry();
    await telemetryStarted!.future;
    await Toggly.init(
        appKey: 'second-app',
        identity: 'bob',
        useSignedDefinitions: false,
        config: config);
    Toggly.incrementCounter('new');
    final second = Toggly.flushTelemetry();
    await Future<void>.delayed(const Duration(milliseconds: 40));
    expect(sent, hasLength(1));
    heldResponse!.complete();
    await first;
    await second;
    expect(sent.map((b) => b['k']).toList(), ['first-app', 'second-app']);
  });

  test('token replaces targeting context and clearing restores client identity',
      () async {
    await Toggly.init(
        appKey: 'key',
        identity: 'alice',
        instanceId: 'token-a',
        groups: ['beta'],
        claims: {'role': 'admin'},
        useSignedDefinitions: false,
        config: config);
    expect(requests.last.queryParameters, {'i': 'token-a'});
    Toggly.recordUsage('first');
    await Toggly.setIdentity('bob', instanceId: 'token-b');
    expect(requests.last.queryParameters, {'i': 'token-b'});
    expect(requests.last.headers['If-None-Match'], isNull);
    Toggly.recordUsage('second');
    await Toggly.setIdentity(null);
    expect(requests.last.queryParameters.containsKey('i'), false);
    expect(requests.last.queryParameters['u'], isNot('bob'));
    Toggly.recordUsage('logout');
    await Toggly.flushTelemetry();
    expect(sent.map((b) => b['i']).toList(), ['token-a', 'token-b', null]);
    expect(sent.last['u'], requests.last.queryParameters['u']);
  });

  test('minted definitions suppress inherited identity query fields', () async {
    final inherited = TogglyConfig(
        baseURI:
            'https://definitions.invalid/base?u=old&g=admin&claim.role=owner&locale=en',
        metricsBaseUrl: config.metricsBaseUrl,
        enableLiveUpdates: false);
    await Toggly.init(
        appKey: 'key',
        identity: 'alice',
        instanceId: 'token',
        useSignedDefinitions: false,
        config: inherited);
    expect(requests.last.uri.path, '/base/evaluated-signed/key/Production');
    expect(requests.last.uri.queryParameters, {'i': 'token', 'locale': 'en'});
  });

  test('late invalid initial cache cannot clear a newer token scope', () async {
    final cache = _MemoryCache();
    final held = Completer<TogglyFeatureFlagsCache?>();
    final started = Completer<void>();
    cache.readHook = (key) {
      if (key.contains('token-a')) {
        if (!started.isCompleted) started.complete();
        return held.future;
      }
      return Future.value(cache.flags[key]);
    };
    final cachedConfig = TogglyConfig(
        baseURI: config.baseURI,
        metricsBaseUrl: config.metricsBaseUrl,
        enableLiveUpdates: false,
        cacheProvider: cache);
    final old = Toggly.init(
        appKey: 'key',
        identity: 'alice',
        instanceId: 'token-a',
        useSignedDefinitions: false,
        config: cachedConfig);
    await started.future;
    await Toggly.setInstanceId('token-b');
    held.complete(TogglyFeatureFlagsCache(
        identity: 'invalid-scope',
        flags: '{}',
        timestamp: null,
        signature: null,
        keyId: null));
    await old;
    expect(Toggly.featureFlagsSnapshot, {'a': true});
    expect(cache.deleted, isEmpty);
  });

  test('local gate transition attributes old snapshot to previous user',
      () async {
    await Toggly.init(
        appKey: 'key',
        identity: 'alice',
        useSignedDefinitions: false,
        config: config);
    Future<TogglyInitResponse>? transition;
    Toggly.setLocalGates([
      LocalGate(
          id: 'switch',
          flagKeys: ['a'],
          isEnabled: () {
            transition = Toggly.setIdentity('bob');
            return true;
          })
    ]);
    expect(
        Toggly.evaluateFeatureGateSync(['a'],
            flags: Toggly.featureFlagsSnapshot),
        true);
    await transition;
    Toggly.incrementCounter('new');
    await Toggly.flushTelemetry();
    expect(sent.where((b) => b['u'] == 'alice').single['f'], {
      'a': {
        'enabled': [1]
      }
    });
    expect(sent.where((b) => b['u'] == 'bob').single['m'], {'new': 1});
  });

  test('token ABA cannot install an earlier response or revision', () async {
    final old = Completer<void>();
    final started = Completer<void>();
    var count = 0;
    HttpService.getInstance.http.interceptors
      ..clear()
      ..add(InterceptorsWrapper(onRequest: (r, h) async {
        count++;
        final sequence = count;
        if (sequence == 1) {
          started.complete();
          await old.future;
        }
        h.resolve(Response(
            requestOptions: r,
            statusCode: 200,
            data: {
              'defs': {'a': sequence != 1}
            },
            headers: Headers.fromMap({
              'etag': ['"rev-$sequence"']
            })));
      }));
    final first = Toggly.init(
        appKey: 'key',
        identity: 'alice',
        instanceId: 'A',
        useSignedDefinitions: false,
        config: config);
    await started.future;
    await Toggly.setInstanceId('B');
    await Toggly.setInstanceId('A');
    old.complete();
    await first;
    expect(Toggly.featureFlagsSnapshot, {'a': true});
    expect(Toggly.debug()['definitionsRevision'], 'rev-3');
  });
}

class _MemoryCache extends TogglyCacheProvider {
  final flags = <String, TogglyFeatureFlagsCache>{};
  final deleted = <String>[];
  Future<TogglyFeatureFlagsCache?> Function(String)? readHook;
  @override
  Future<TogglyFeatureFlagsCache?> readFlags(String key) =>
      readHook?.call(key) ?? Future.value(flags[key]);
  @override
  Future<void> writeFlags(TogglyFeatureFlagsCache cache) async {
    flags[cache.identity] = cache;
  }

  @override
  Future<void> deleteFlags(String key) async {
    deleted.add(key);
    flags.remove(key);
  }

  @override
  Future<TogglyVariantsCache?> readVariants(String key) async => null;
  @override
  Future<void> writeVariants(TogglyVariantsCache cache) async {}
  @override
  Future<void> deleteVariants(String key) async {
    deleted.add(key);
  }

  @override
  Future<String?> readJwks() async => null;
  @override
  Future<void> writeJwks(String value) async {}
  @override
  Future<void> deleteJwks() async {}
}
