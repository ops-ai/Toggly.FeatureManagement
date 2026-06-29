import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('buildFlagGateIndex rejects duplicate flag keys across gates', () {
    expect(
      () => buildFlagGateIndex([
        LocalGate(id: 'a', flagKeys: ['X'], isEnabled: () => true),
        LocalGate(id: 'b', flagKeys: ['X'], isEnabled: () => true),
      ]),
      throwsArgumentError,
    );
  });

  test('applyLocalGate ANDs remote true with local prerequisite', () {
    final gates = [
      LocalGate(id: 'g', flagKeys: ['F1'], isEnabled: () => false),
    ];
    final index = buildFlagGateIndex(gates);
    expect(applyLocalGate(true, 'F1', gates, index), false);
    expect(applyLocalGate(true, 'Other', gates, index), true);
  });
}
