
import 'package:flutter_test/flutter_test.dart';
import 'package:toggly/toggly.dart';

void main() {
  tearDown(() {
    Toggly.dispose();
  });

  test('getVariantValue returns null when no variant assigned', () async {
    await Toggly.init(
      useSignedDefinitions: false,
      flagDefaults: {'Cfg': true},
      config: const TogglyConfig(enableVariants: true),
    );
    expect(await Toggly.getVariantValue('Cfg'), isNull);
    expect(
      await Toggly.getVariantValue<Checkout>('Cfg', Checkout.fromJson),
      isNull,
    );
  });
}

class Checkout {
  Checkout({required this.color});
  final String color;
  factory Checkout.fromJson(Map<String, dynamic> json) =>
      Checkout(color: json['color'] as String);
}
