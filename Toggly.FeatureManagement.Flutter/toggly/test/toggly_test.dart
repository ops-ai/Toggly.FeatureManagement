import 'package:flutter_test/flutter_test.dart';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';

void main() {
  setUp(() async {
    await Toggly.init(
      flagDefaults: {
        "TrueFeatureKey": true,
        "FalseFeatureKey": false,
      },
    );
  });

  group('*.evaluateFeatureGate', () {
    test('Check result based on provided *.flagDefaults', () async {
      bool trueGateValue = await Toggly.evaluateFeatureGate(
        ["TrueFeatureKey"],
      );
      bool falseGateValue = await Toggly.evaluateFeatureGate(
        ["FalseFeatureKey"],
      );

      expect(trueGateValue, true);
      expect(falseGateValue, false);
    });

    test('Check (requirement: All) result based on provided *.flagDefaults',
        () async {
      bool allGateValue = await Toggly.evaluateFeatureGate(
        ["TrueFeatureKey", "FalseFeatureKey"],
        requirement: FeatureRequirement.all,
      );

      expect(allGateValue, false);
    });

    test('Check (requirement: Any) result based on provided *.flagDefaults',
        () async {
      bool anyGateValue = await Toggly.evaluateFeatureGate(
        ["TrueFeatureKey", "FalseFeatureKey"],
        requirement: FeatureRequirement.any,
      );

      expect(anyGateValue, true);
    });

    test('Check (negate) result based on provided *.flagDefaults', () async {
      bool negateGateValue = await Toggly.evaluateFeatureGate(
        ["TrueFeatureKey"],
        negate: true,
      );

      expect(negateGateValue, false);
    });
  });
}
