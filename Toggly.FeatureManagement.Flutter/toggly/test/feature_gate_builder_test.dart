import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() {
    Toggly.dispose();
  });

  group('evaluateFeatureGateSync with local gates', () {
    test('local gate state affects sync evaluation at read time', () async {
      Toggly.dispose();
      var gateEnabled = false;
      await Toggly.init(
        useSignedDefinitions: false,
        flagDefaults: {'PremiumCheckout': true},
        config: TogglyConfig(
          localGates: [
            LocalGate(
              id: 'sales',
              flagKeys: ['PremiumCheckout'],
              isEnabled: () => gateEnabled,
            ),
          ],
        ),
      );

      expect(
        Toggly.evaluateFeatureGateSync(
          ['PremiumCheckout'],
          flags: Toggly.featureFlagsSnapshot,
        ),
        false,
      );

      gateEnabled = true;
      expect(
        Toggly.evaluateFeatureGateSync(
          ['PremiumCheckout'],
          flags: Toggly.featureFlagsSnapshot,
        ),
        true,
      );
    });
  });

  group('FeatureGateBuilder', () {
    testWidgets('remote flag on and local gate off yields enabled false',
        (tester) async {
      Toggly.dispose();
      var gateEnabled = false;
      await Toggly.init(
        useSignedDefinitions: false,
        flagDefaults: {'PremiumCheckout': true},
        config: TogglyConfig(
          localGates: [
            LocalGate(
              id: 'sales',
              flagKeys: ['PremiumCheckout'],
              isEnabled: () => gateEnabled,
            ),
          ],
        ),
      );

      bool? lastEnabled;
      await tester.pumpWidget(
        MaterialApp(
          home: FeatureGateBuilder(
            featureKeys: const ['PremiumCheckout'],
            builder: (context, enabled) {
              lastEnabled = enabled;
              return Text('enabled:$enabled');
            },
          ),
        ),
      );
      await tester.pump();

      expect(lastEnabled, false);
      expect(find.text('enabled:false'), findsOneWidget);

      gateEnabled = true;
      Toggly.notifyLocalGatesChanged();
      await tester.pump();
      await tester.pump();

      expect(lastEnabled, true);
      expect(find.text('enabled:true'), findsOneWidget);
    });

    testWidgets('notifyLocalGatesChanged rebuilds without network fetch',
        (tester) async {
      Toggly.dispose();
      var gateEnabled = false;
      await Toggly.init(
        useSignedDefinitions: false,
        flagDefaults: {'ApiV2Checkout': true},
        config: TogglyConfig(
          localGates: [
            LocalGate(
              id: 'apiRedesign',
              flagKeys: ['ApiV2Checkout'],
              isEnabled: () => gateEnabled,
            ),
          ],
        ),
      );

      var buildCount = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: FeatureGateBuilder(
            featureKeys: const ['ApiV2Checkout'],
            builder: (context, enabled) {
              buildCount++;
              return Text('build:$buildCount enabled:$enabled');
            },
          ),
        ),
      );
      await tester.pump();

      expect(buildCount, greaterThanOrEqualTo(1));
      expect(find.textContaining('enabled:false'), findsOneWidget);

      final countBeforeNotify = buildCount;
      gateEnabled = true;
      Toggly.notifyLocalGatesChanged();
      await tester.pump();
      await tester.pump();

      expect(buildCount, greaterThan(countBeforeNotify));
      expect(find.textContaining('enabled:true'), findsOneWidget);
    });

    testWidgets('requirement any matches Feature gate behavior',
        (tester) async {
      Toggly.dispose();
      await Toggly.init(
        useSignedDefinitions: false,
        flagDefaults: {
          'TrueFeatureKey': true,
          'FalseFeatureKey': false,
        },
      );

      bool? lastEnabled;
      await tester.pumpWidget(
        MaterialApp(
          home: FeatureGateBuilder(
            featureKeys: const ['TrueFeatureKey', 'FalseFeatureKey'],
            requirement: FeatureRequirement.any,
            builder: (context, enabled) {
              lastEnabled = enabled;
              return const SizedBox();
            },
          ),
        ),
      );
      await tester.pump();

      expect(lastEnabled, true);
    });

    testWidgets('requirement all matches Feature gate behavior',
        (tester) async {
      Toggly.dispose();
      await Toggly.init(
        useSignedDefinitions: false,
        flagDefaults: {
          'TrueFeatureKey': true,
          'FalseFeatureKey': false,
        },
      );

      bool? lastEnabled;
      await tester.pumpWidget(
        MaterialApp(
          home: FeatureGateBuilder(
            featureKeys: const ['TrueFeatureKey', 'FalseFeatureKey'],
            requirement: FeatureRequirement.all,
            builder: (context, enabled) {
              lastEnabled = enabled;
              return const SizedBox();
            },
          ),
        ),
      );
      await tester.pump();

      expect(lastEnabled, false);
    });

    testWidgets('negate matches Feature gate behavior', (tester) async {
      Toggly.dispose();
      await Toggly.init(
        useSignedDefinitions: false,
        flagDefaults: {'TrueFeatureKey': true},
      );

      bool? lastEnabled;
      await tester.pumpWidget(
        MaterialApp(
          home: FeatureGateBuilder(
            featureKeys: const ['TrueFeatureKey'],
            negate: true,
            builder: (context, enabled) {
              lastEnabled = enabled;
              return const SizedBox();
            },
          ),
        ),
      );
      await tester.pump();

      expect(lastEnabled, false);
    });

    testWidgets('variant treats gate as disabled until variant matches',
        (tester) async {
      Toggly.dispose();
      await Toggly.init(
        useSignedDefinitions: false,
        flagDefaults: {'Experiment': true},
        config: const TogglyConfig(enableVariants: false),
      );

      bool? lastEnabled;
      await tester.pumpWidget(
        MaterialApp(
          home: FeatureGateBuilder(
            featureKeys: const ['Experiment'],
            variant: 'control',
            builder: (context, enabled) {
              lastEnabled = enabled;
              return Text('enabled:$enabled');
            },
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(lastEnabled, false);
      expect(find.text('enabled:false'), findsOneWidget);
    });

    testWidgets('always invokes builder even when gate is off', (tester) async {
      Toggly.dispose();
      await Toggly.init(
        useSignedDefinitions: false,
        flagDefaults: {'HiddenFeature': false},
      );

      await tester.pumpWidget(
        MaterialApp(
          home: FeatureGateBuilder(
            featureKeys: const ['HiddenFeature'],
            builder: (context, enabled) {
              return Text('visible:$enabled');
            },
          ),
        ),
      );
      await tester.pump();

      expect(find.text('visible:false'), findsOneWidget);
    });
  });

  group('Feature.builder', () {
    testWidgets('exposes enabled to builder callback', (tester) async {
      Toggly.dispose();
      await Toggly.init(
        useSignedDefinitions: false,
        flagDefaults: {'FeatureA': true},
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Feature.builder(
            featureKeys: const ['FeatureA'],
            builder: (context, enabled) => Text('on:$enabled'),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('on:true'), findsOneWidget);
    });
  });

  group('Feature show/hide (unchanged)', () {
    testWidgets('hides child when gate is off', (tester) async {
      Toggly.dispose();
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
      await tester.pump();

      expect(find.text('Visible feature'), findsNothing);
    });

    testWidgets('rebuilds when feature flags stream emits', (tester) async {
      Toggly.dispose();
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
      await tester.pump();

      expect(find.text('Visible feature'), findsNothing);

      Toggly.cacheFeatureFlags(featureFlags: '{"FeatureA":true}');
      await tester.pump();
      await tester.pump();

      expect(find.text('Visible feature'), findsOneWidget);
    });
  });
}
