import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter/material.dart';

const definitionsUrl = String.fromEnvironment('DEFINITIONS_URL');
const metricsUrl = String.fromEnvironment('METRICS_URL');
const autoProbe = bool.fromEnvironment('AUTO_PROBE');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AcceptanceApp());
}

class AcceptanceApp extends StatefulWidget {
  const AcceptanceApp({super.key});

  @override
  State<AcceptanceApp> createState() => _AcceptanceAppState();
}

class _AcceptanceAppState extends State<AcceptanceApp> {
  String status = 'Idle';
  bool initialized = false;

  @override
  void initState() {
    super.initState();
    if (autoProbe) {
      WidgetsBinding.instance.addPostFrameCallback((_) => runProbe());
    }
  }

  Future<void> runProbe() async {
    if (definitionsUrl.isEmpty || metricsUrl.isEmpty) {
      setState(() => status = 'Set local DEFINITIONS_URL and METRICS_URL');
      return;
    }
    try {
      await Toggly.init(
        appKey: 'local-public-consumer',
        environment: 'Acceptance',
        identity: 'native-a',
        useSignedDefinitions: true,
        flagDefaults: const {'checkout': true, 'disabled': false},
        config: const TogglyConfig(
          baseURI: definitionsUrl,
          metricsBaseUrl: metricsUrl,
          enableLiveUpdates: false,
          enableVariants: true,
        ),
      );
      if (mounted) setState(() => initialized = true);
      final flags = Toggly.featureFlagsSnapshot;
      final sync = Toggly.evaluateFeatureGateSync(['checkout'], flags: flags);
      final gate = await Toggly.evaluateFeatureGate([
        'disabled',
        'checkout',
      ], requirement: FeatureRequirement.any);
      final negated = await Toggly.evaluateFeatureGate([
        'disabled',
      ], negate: true);
      final variant = await Toggly.getVariant('checkout');
      Toggly.recordUsage('checkout', 'blue');
      Toggly.recordView('checkout', 'blue');
      Toggly.incrementCounter('orders', 2);
      Toggly.setGauge('queue', 3);
      await Toggly.flushTelemetry();
      await Toggly.setIdentity('native-b', instanceId: 'local-minted-fixture');
      Toggly.recordUsage('checkout');
      await Toggly.flushTelemetry();
      if (mounted) {
        setState(
          () => status =
              'sync=$sync gate=$gate negate=$negated '
              'variant=${variant.name}',
        );
      }
    } catch (error) {
      if (mounted) setState(() => status = 'Probe failed: $error');
    }
  }

  @override
  void dispose() {
    Toggly.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    home: Scaffold(
      appBar: AppBar(title: const Text('Toggly public Flutter acceptance')),
      body: Column(
        children: [
          if (initialized) ...[
            const Feature(
              featureKeys: ['checkout'],
              child: Text('Checkout enabled'),
            ),
            const Feature(
              featureKeys: ['disabled'],
              negate: true,
              child: Text('Disabled flag negated'),
            ),
          ],
          Text(status, key: const Key('status')),
          ElevatedButton(
            onPressed: runProbe,
            child: const Text('Run local probe'),
          ),
        ],
      ),
    ),
  );
}
