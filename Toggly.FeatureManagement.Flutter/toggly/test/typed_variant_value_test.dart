import 'dart:convert';
import 'dart:io';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late HttpServer server;
  late Map<String, dynamic> variantDefinitions;

  setUp(() async {
    HttpOverrides.global = null;
    variantDefinitions = {
      'Cfg': {
        'enabled': true,
        'variant': 'blue',
        'configurationValue': {'color': 'blue'},
      },
      'Scalar': {
        'enabled': true,
        'variant': 'n',
        'configurationValue': 7,
      },
      'Bad': {
        'enabled': true,
        'variant': 'x',
        'configurationValue': {'color': 1},
      },
    };
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      if (request.uri.path.contains('evaluated-variants-signed')) {
        request.response.write(jsonEncode({
          'defs': variantDefinitions,
          'signature': 'test',
          'timestamp': 1,
          'kid': 'test',
        }));
      } else {
        request.response.headers.contentType = ContentType.json;
        request.response.write(jsonEncode({
          'defs': {'Cfg': true, 'Scalar': true, 'Bad': true, 'Missing': true},
        }));
      }
      await request.response.close();
    });
  });

  tearDown(() async {
    Toggly.dispose();
    await server.close(force: true);
  });

  Future<void> initVariants() async {
    final base = 'http://${server.address.host}:${server.port}';
    await Toggly.init(
      appKey: 'test-key',
      useSignedDefinitions: false,
      config: TogglyConfig(
        baseURI: base,
        enableLiveUpdates: false,
        enableVariants: true,
      ),
    );
  }

  test('getVariantValue returns null when no variant assigned', () async {
    await initVariants();
    expect(await Toggly.getVariantValue('Missing'), isNull);
    expect(
      await Toggly.getVariantValue<Checkout>('Missing', Checkout.fromJson),
      isNull,
    );
  });

  test('getVariantValue soft-decodes map payloads with fromJson', () async {
    await initVariants();
    final checkout =
        await Toggly.getVariantValue<Checkout>('Cfg', Checkout.fromJson);
    expect(checkout?.color, 'blue');
  });

  test('getVariantValue returns raw value without fromJson', () async {
    await initVariants();
    expect(await Toggly.getVariantValue('Scalar'), 7);
    expect(await Toggly.getVariantValue('Cfg'), {'color': 'blue'});
  });

  test('getVariantValue soft-nulls when payload is not a map', () async {
    await initVariants();
    expect(
      await Toggly.getVariantValue<Checkout>('Scalar', Checkout.fromJson),
      isNull,
    );
  });

  test('getVariantValue soft-nulls when fromJson throws', () async {
    await initVariants();
    expect(
      await Toggly.getVariantValue<Checkout>('Bad', Checkout.fromJson),
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
