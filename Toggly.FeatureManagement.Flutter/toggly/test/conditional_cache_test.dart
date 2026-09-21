import 'dart:convert';
import 'dart:io';
import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

class _MemoryCache extends TogglyCacheProvider
    implements TogglyRevisionCacheProvider {
  final flags = <String, TogglyFeatureFlagsCache>{};
  final variants = <String, TogglyVariantsCache>{};
  final revisions = <String, String>{};
  @override
  Future<TogglyFeatureFlagsCache?> readFlags(String k) async => flags[k];
  @override
  Future<void> writeFlags(TogglyFeatureFlagsCache c) async {
    flags[c.identity] = c;
  }

  @override
  Future<void> deleteFlags(String k) async {
    flags.remove(k);
  }

  @override
  Future<TogglyVariantsCache?> readVariants(String k) async => variants[k];
  @override
  Future<void> writeVariants(TogglyVariantsCache c) async {
    variants[c.identity] = c;
  }

  @override
  Future<void> deleteVariants(String k) async {
    variants.remove(k);
  }

  @override
  Future<String?> readJwks() async => null;
  @override
  Future<void> writeJwks(String s) async {}
  @override
  Future<void> deleteJwks() async {}
  @override
  Future<String?> readDefinitionsRevision(String a, String e, String i) async =>
      revisions['$a:$e:$i'];
  @override
  Future<void> writeDefinitionsRevision(
      String a, String e, String i, String r) async {
    revisions['$a:$e:$i'] = r;
  }

  @override
  Future<void> deleteDefinitionsRevision(String a, String e, String i) async {
    revisions.remove('$a:$e:$i');
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    HttpOverrides.global = null;
    TestWidgetsFlutterBinding.instance
        .handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    HttpService.getInstance.http.interceptors.clear();
  });
  tearDown(() {
    Toggly.dispose();
  });
  test('token A B A cache miss must refetch instead of accepting unusable 304',
      () async {
    final cache = _MemoryCache();
    final seen = <Map<String, String?>>[];
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((r) async {
      final token = r.uri.queryParameters['i'];
      final etag = '"rev-$token"';
      final conditional = r.headers.value('if-none-match');
      seen.add({'i': token, 'if-none-match': conditional});
      r.response.headers.set('etag', etag);
      if (conditional == etag || conditional == 'rev-$token') {
        r.response.statusCode = 304;
      } else {
        r.response.headers.contentType = ContentType.json;
        r.response.write(jsonEncode({
          'defs': {'a': token == 'A'}
        }));
      }
      await r.response.close();
    });
    await Toggly.init(
        appKey: 'key',
        instanceId: 'A',
        useSignedDefinitions: false,
        flagDefaults: {'a': false},
        config: TogglyConfig(
            baseURI: 'http://127.0.0.1:${server.port}',
            enableTelemetry: false,
            enableLiveUpdates: false,
            cacheProvider: cache));
    expect(Toggly.featureFlagsSnapshot['a'], true);
    await Toggly.setInstanceId('B');
    cache.flags.remove('i:["key","Production","A"]');
    await Toggly.setInstanceId('A');
    expect(seen.map((r) => r['if-none-match']), [null, null, null]);
    expect(Toggly.featureFlagsSnapshot['a'], true,
        reason: 'A definitions missing but revision reused; server has A=true');
  });
  test(
      'first minted context must load assigned variants before conditional fetch',
      () async {
    final seen = <String>[];
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((r) async {
      final conditional = r.headers.value('if-none-match');
      seen.add('${r.uri.path}: $conditional');
      r.response.headers.set('etag', '"same-revision"');
      if (conditional != null) {
        r.response.statusCode = 304;
      } else {
        r.response.headers.contentType = ContentType.json;
        r.response.write(jsonEncode(r.uri.path.contains('variants')
            ? {
                'defs': {
                  'a': {'enabled': true, 'variant': 'blue'}
                },
                'signature': '',
                'timestamp': 1,
                'kid': 'test'
              }
            : {
                'defs': {'a': true}
              }));
      }
      await r.response.close();
    });
    await Toggly.init(
        appKey: 'key',
        instanceId: 'A',
        useSignedDefinitions: false,
        config: TogglyConfig(
            baseURI: 'http://127.0.0.1:${server.port}',
            enableTelemetry: false,
            enableLiveUpdates: false,
            enableVariants: true));
    final v = await Toggly.getVariant('a');
    expect(seen.every((r) => r.endsWith(': null')), true);
    expect(v.name, 'blue');
  });
  test('persisted token switch-back hydrates each response body on 304',
      () async {
    final cache = _MemoryCache();
    final requests = <String>[];
    var evictDuringRequest = false;
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((r) async {
      final token = r.uri.queryParameters['i'];
      final mode = r.uri.path.contains('variants') ? 'variants' : 'flags';
      final revision = '$token-$mode';
      final conditional = r.headers.value('if-none-match');
      requests.add('$token/$mode/$conditional');
      r.response.headers.set('etag', '"$revision"');
      if (conditional == revision) {
        // A body already validated in memory must survive storage eviction
        // while its conditional request is in flight.
        if (evictDuringRequest) {
          cache.flags.clear();
          cache.variants.clear();
        }
        r.response.statusCode = 304;
      } else {
        r.response.headers.contentType = ContentType.json;
        r.response.write(jsonEncode(mode == 'variants'
            ? {
                'defs': {
                  'a': {'enabled': true, 'variant': token}
                },
                'signature': '',
                'timestamp': 1,
                'kid': 'test'
              }
            : {
                'defs': {'a': token == 'A'}
              }));
      }
      await r.response.close();
    });
    final config = TogglyConfig(
        baseURI: 'http://127.0.0.1:${server.port}',
        enableTelemetry: false,
        enableLiveUpdates: false,
        enableVariants: true,
        cacheProvider: cache);
    await Toggly.init(
        appKey: 'key',
        instanceId: 'A',
        useSignedDefinitions: false,
        config: config);
    await Toggly.setInstanceId('B');
    // Exercise serialized persistence across an actual in-memory reset.
    final flagsA = TogglyFeatureFlagsCache.fromJson(
        cache.flags['i:["key","Production","A"]']!.toJson());
    final variantsA = TogglyVariantsCache.fromJson(
        cache.variants['i:["key","Production","A"]']!.toJson());
    cache.flags[flagsA.identity] = flagsA;
    cache.variants[variantsA.identity] = variantsA;
    await Toggly.setInstanceId('A');
    expect(Toggly.featureFlagsSnapshot['a'], true);
    expect((await Toggly.getVariant('a')).name, 'A');
    expect(requests.take(4),
        ['A/flags/null', 'A/variants/null', 'B/flags/null', 'B/variants/null']);
    expect(requests[4], 'A/flags/A-flags');
    expect(requests[5], 'A/variants/A-variants');
    evictDuringRequest = true;
    await Toggly.refresh();
    expect(requests.sublist(6), ['A/flags/A-flags', 'A/variants/A-variants']);
    expect((await Toggly.getVariant('a')).name, 'A');
  });

  for (final invalid in ['missing', 'app', 'environment', 'mode', 'json']) {
    test('invalid $invalid body metadata cannot authorize a conditional fetch',
        () async {
      final cache = _MemoryCache();
      const key = 'i:["key","Production","A"]';
      cache.revisions['key:Production:$key'] = 'orphan';
      cache.flags[key] = TogglyFeatureFlagsCache(
        identity: key,
        flags: invalid == 'json' ? '[]' : '{"a":false}',
        timestamp: null,
        signature: null,
        keyId: null,
        revision: invalid == 'missing' ? null : 'orphan',
        appKey: invalid == 'app' ? 'other' : 'key',
        environment: invalid == 'environment' ? 'other' : 'Production',
        signed: invalid == 'mode',
      );
      final seen = <String?>[];
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      server.listen((r) async {
        final conditional = r.headers.value('if-none-match');
        seen.add(conditional);
        if (conditional != null) {
          r.response.statusCode = 304;
        } else {
          r.response.headers.contentType = ContentType.json;
          r.response.write('{"defs":{"a":true}}');
        }
        await r.response.close();
      });
      await Toggly.init(
          appKey: 'key',
          instanceId: 'A',
          useSignedDefinitions: false,
          config: TogglyConfig(
              baseURI: 'http://127.0.0.1:${server.port}',
              enableTelemetry: false,
              enableLiveUpdates: false,
              cacheProvider: cache));
      expect(seen, [null]);
      expect(Toggly.featureFlagsSnapshot['a'], true);
    });
  }
}
