// Disposable physical iPad host entrypoint; no production keys or services.
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:feature_flags_toggly_secure_storage/feature_flags_toggly_secure_storage.dart';

const stage = String.fromEnvironment('PROBE_STAGE');
const storage = FlutterSecureStorage(
  iOptions: IOSOptions(
    accountName: 'ops1187.ipad.verified',
    accessibility: KeychainAccessibility.unlocked_this_device,
  ),
);
const identity = 'ipad-fixture';
const sentinel = 'ops1187-keychain-fixture';
Future<void> emit(String value) =>
    const MethodChannel('ops1187.keychain').invokeMethod<void>('log', value);

void check(bool value, String description) {
  if (!value) throw StateError(description);
  emit('IPAD_CHECK:$description');
}

Future<void> probe() async {
  final provider = SecureStorageCacheProvider(storage: storage);
  final previous = await storage.read(key: 'host.stage');
  if (stage == '9' && previous == null) {
    // Seed once. Upgrades and restarts must never repair missing fixture data.
    await provider.writeFlags(
      TogglyFeatureFlagsCache(
        identity: identity,
        flags: '{"FeatureA":true}',
        timestamp: 1000,
        signature: 'sig',
        keyId: 'kid',
      ),
    );
    await provider.writeVariants(
      TogglyVariantsCache(
        identity: identity,
        variants: '{"FeatureA":{"enabled":true}}',
        timestamp: 1001,
        signature: 'variant-sig',
        keyId: 'variant-kid',
      ),
    );
    await provider.writeJwks('{"keys":[]}');
    await provider.writeCacheLruIndex('["ipad-fixture"]');
    await storage.write(
      key: 'toggly.revision.fixture:Production',
      value: 'legacy-revision',
    );
    await storage.write(key: 'host.unrelated', value: sentinel);
    await storage.write(key: 'toggly.flags.malformed', value: 'not-json{');
    await storage.write(key: 'toggly.variants.malformed', value: 'not-json{');
    await storage.write(key: 'host.launches', value: '0');
    // Mark seeding before assertions so a failed probe never reseeds on retry.
    await storage.write(key: 'host.stage', value: '9');
  } else {
    check(
      previous == stage ||
          (stage == '10' && previous == '9') ||
          (stage == '11' && previous == '10'),
      'prior-stage-preserved',
    );
  }
  final flags = await provider.readFlags(identity);
  check(
    flags?.flags == '{"FeatureA":true}' &&
        flags?.timestamp == 1000 &&
        flags?.signature == 'sig' &&
        flags?.keyId == 'kid',
    'flags-and-signature-preserved',
  );
  final variants = await provider.readVariants(identity);
  check(
    variants?.variants == '{"FeatureA":{"enabled":true}}' &&
        variants?.timestamp == 1001 &&
        variants?.signature == 'variant-sig' &&
        variants?.keyId == 'variant-kid',
    'variants-and-signature-preserved',
  );
  check(await provider.readJwks() == '{"keys":[]}', 'jwks-preserved');
  check(
    await provider.readCacheLruIndex() == '["ipad-fixture"]',
    'lru-preserved',
  );
  check(
    await provider.readDefinitionsRevision('fixture', 'Production', identity) ==
        'legacy-revision',
    'legacy-revision-migration',
  );
  check(
    await storage.read(key: 'toggly.revision.fixture:Production:$identity') ==
        'legacy-revision',
    'identity-revision-written',
  );
  check(
    await storage.read(key: 'toggly.revision.fixture:Production') == null,
    'legacy-revision-removed',
  );
  check(
    await storage.read(key: 'host.unrelated') == sentinel,
    'unrelated-key-preserved',
  );
  check(
    await const MethodChannel(
          'ops1187.keychain',
        ).invokeMethod<bool>('protected') ==
        true,
    'native-keychain-device-only-protection',
  );
  check(
    await provider.readFlags('malformed') == null &&
        await provider.readVariants('malformed') == null &&
        await storage.read(key: 'toggly.flags.malformed') == 'not-json{' &&
        await storage.read(key: 'toggly.variants.malformed') == 'not-json{',
    'malformed-preserved',
  );
  check(
    await provider.readFlags('other-identity') == null,
    'identity-isolation',
  );
  // A real Keychain authorization failure; no mocked method channel.
  const denied = FlutterSecureStorage(
    iOptions: IOSOptions(
      accountName: 'ops1187.ipad.verified',
      groupId: 'invalid.ops1187.denied',
    ),
  );
  bool failed = false;
  try {
    await SecureStorageCacheProvider(
      storage: denied,
    ).writeJwks('must-not-replace');
  } on PlatformException {
    failed = true;
  }
  check(
    failed && await provider.readJwks() == '{"keys":[]}',
    'native-failure-preserves-data',
  );
  await provider.writeFlags(
    TogglyFeatureFlagsCache(
      identity: 'roundtrip',
      flags: '{}',
      timestamp: null,
      signature: null,
      keyId: null,
    ),
  );
  check(
    (await SecureStorageCacheProvider(
          storage: storage,
        ).readFlags('roundtrip'))?.flags ==
        '{}',
    'injected-provider-native-roundtrip',
  );
  await provider.deleteFlags('roundtrip');
  check(await provider.readFlags('roundtrip') == null, 'scoped-delete');
  // Deterministic loopback host on the device; never contacts Toggly production.
  var enabled = true;
  var requests = 0;
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  server.listen((request) async {
    requests++;
    request.response.headers.contentType = ContentType.json;
    request.response.write(
      jsonEncode({'RemoteFlag': enabled, 'GatedFlag': true}),
    );
    await request.response.close();
  });
  var gateOpen = false;
  final initialization = await Toggly.init(
    appKey: 'local-fixture',
    identity: 'runtime-fixture',
    useSignedDefinitions: false,
    config: TogglyConfig(
      baseURI: 'http://127.0.0.1:${server.port}',
      cacheProvider: provider,
      enableLiveUpdates: false,
      featureFlagsRefreshInterval: 200,
      localGates: [
        LocalGate(
          id: 'device-gate',
          flagKeys: ['GatedFlag'],
          isEnabled: () => gateOpen,
        ),
      ],
    ),
  );
  await emit(
    'IPAD_INIT:status=${initialization.status.name}:requests=$requests:lifecycle=${WidgetsBinding.instance.lifecycleState?.name}',
  );
  check(
    await Toggly.evaluateFeatureGate(['RemoteFlag']),
    'initialization-remote-flags',
  );
  check(!await Toggly.evaluateFeatureGate(['GatedFlag']), 'local-gate-closed');
  gateOpen = true;
  Toggly.notifyLocalGatesChanged();
  check(await Toggly.evaluateFeatureGate(['GatedFlag']), 'local-gate-open');
  enabled = false;
  await Toggly.refresh();
  check(
    !await Toggly.evaluateFeatureGate(['RemoteFlag']),
    'refresh-updates-flags',
  );
  Toggly.dispose();
  await Future<void>.delayed(const Duration(milliseconds: 300));
  final settled = requests;
  await Future<void>.delayed(const Duration(milliseconds: 600));
  check(requests == settled, 'shutdown-stops-polling');
  await server.close(force: true);
  final launches = int.parse((await storage.read(key: 'host.launches'))!) + 1;
  await storage.write(key: 'host.launches', value: '$launches');
  await storage.write(key: 'host.stage', value: stage);
  await emit('IPAD_PASS:stage=$stage:launch=$launches');
}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const MaterialApp(
      home: Scaffold(body: Center(child: Text('Toggly iPad validation'))),
    ),
  );
  WidgetsBinding.instance.addPostFrameCallback((_) async {
    try {
      final deadline = DateTime.now().add(const Duration(seconds: 10));
      while (WidgetsBinding.instance.lifecycleState !=
              AppLifecycleState.resumed &&
          DateTime.now().isBefore(deadline)) {
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }
      check(
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed,
        'app-resumed',
      );
      await probe();
      exit(0);
    } catch (error, stack) {
      await emit('IPAD_FAIL:$error\n$stack');
      exit(1);
    }
  });
}
