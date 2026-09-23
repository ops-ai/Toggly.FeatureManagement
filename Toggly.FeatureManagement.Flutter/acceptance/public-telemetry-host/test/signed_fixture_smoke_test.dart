import 'dart:io';
import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'ephemeral local signed definitions fixture verifies through hosted SDK',
    () async {
      HttpOverrides.global = null;
      TestWidgetsFlutterBinding.instance.handleAppLifecycleStateChanged(
        AppLifecycleState.resumed,
      );
      final socket = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      final port = socket.port;
      await socket.close();
      final process = await Process.start('python3', [
        'tool/collector.py',
        '--port',
        '$port',
        '--output',
        '/private/tmp/ops1387-smoke-packets.jsonl',
      ]);
      try {
        await process.stdout.transform(const SystemEncoding().decoder).first;
        final base = 'http://127.0.0.1:$port';
        await Toggly.init(
          appKey: 'fixture-key',
          environment: 'Acceptance',
          identity: 'user-a',
          useSignedDefinitions: true,
          flagDefaults: const {'checkout': false},
          config: TogglyConfig(
            baseURI: base,
            metricsBaseUrl: base,
            enableLiveUpdates: false,
            enableVariants: true,
            featureFlagsRefreshInterval: 3600000,
          ),
        );
        expect(Toggly.debug()['lastError'], isNull);
        expect(await Toggly.isFeatureOn('checkout'), isTrue);
        expect((await Toggly.getVariant('checkout')).name, 'blue');
        await Toggly.flushTelemetry();
      } finally {
        Toggly.dispose();
        process.kill();
        await process.exitCode;
      }
    },
  );
}
