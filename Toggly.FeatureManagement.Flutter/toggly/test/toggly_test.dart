import 'package:flutter_test/flutter_test.dart';

import 'package:toggly/toggly.dart';

void main() {
  setUp(() async {
    await Toggly.init(
      flagDefaults: {
        "TrueFeatureKey": true,
        "FalseFeatureKey": false,
      },
    );
  });

  group('*.featureGateFuture', () {
    test('Check result based on provided *.flagDefaults', () async {
      bool trueGateValue = await Toggly.featureGateFuture(
        ["TrueFeatureKey"],
      );
      bool falseGateValue = await Toggly.featureGateFuture(
        ["FalseFeatureKey"],
      );

      expect(trueGateValue, true);
      expect(falseGateValue, false);
    });

    test('Check (requirement: All) result based on provided *.flagDefaults',
        () async {
      bool allGateValue = await Toggly.featureGateFuture(
        ["TrueFeatureKey", "FalseFeatureKey"],
        requirement: FeatureRequirement.all,
      );

      expect(allGateValue, false);
    });

    test('Check (requirement: Any) result based on provided *.flagDefaults',
        () async {
      bool anyGateValue = await Toggly.featureGateFuture(
        ["TrueFeatureKey", "FalseFeatureKey"],
        requirement: FeatureRequirement.any,
      );

      expect(anyGateValue, true);
    });

    test('Check (negate) result based on provided *.flagDefaults', () async {
      bool negateGateValue = await Toggly.featureGateFuture(
        ["TrueFeatureKey"],
        negate: true,
      );

      expect(negateGateValue, false);
    });
  });
}
