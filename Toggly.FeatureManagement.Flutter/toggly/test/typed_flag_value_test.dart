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
      'StringFlag': {
        'enabled': true,
        'variant': 'default',
        'valueType': 'string',
        'configurationValue': 'hello',
      },
      'NumberFlag': {
        'enabled': true,
        'variant': 'default',
        'valueType': 'number',
        'configurationValue': 42,
      },
      'JsonFlag': {
        'enabled': true,
        'variant': 'default',
        'valueType': 'json',
        'configurationValue': {'color': 'blue'},
      },
      'DateTimeFlag': {
        'enabled': true,
        'variant': 'default',
        'valueType': 'datetime',
        'configurationValue': '2026-01-15T10:00:00Z',
      },
      'MismatchedType': {
        'enabled': true,
        'variant': 'default',
        'valueType': 'number',
        'configurationValue': 'not-a-number-type',
      },
      'Disabled': {
        'enabled': false,
        'variant': 'default',
        'valueType': 'string',
        'configurationValue': 'hidden',
      },
      'Legacy': {
        'enabled': true,
        'variant': 'default',
        'configurationValue': 'no-declared-type',
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
          'defs': {
            for (final key in variantDefinitions.keys) key: true,
          },
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

  test('getStringValue returns the typed string', () async {
    await initVariants();
    expect(await Toggly.getStringValue('StringFlag'), 'hello');
  });

  test('getStringValue soft-nulls a number-typed flag', () async {
    await initVariants();
    expect(await Toggly.getStringValue('NumberFlag'), isNull);
  });

  test('getNumberValue returns the typed number', () async {
    await initVariants();
    expect(await Toggly.getNumberValue('NumberFlag'), 42);
  });

  test('getNumberValue soft-nulls when the declared type disagrees', () async {
    await initVariants();
    expect(await Toggly.getNumberValue('MismatchedType'), isNull);
  });

  test('getJsonValue returns the raw map', () async {
    await initVariants();
    expect(await Toggly.getJsonValue('JsonFlag'), {'color': 'blue'});
  });

  test('getJsonValue soft-decodes through fromJson', () async {
    await initVariants();
    final checkout =
        await Toggly.getJsonValue<Checkout>('JsonFlag', Checkout.fromJson);
    expect(checkout?.color, 'blue');
  });

  test('getDateTimeValue parses an ISO-8601 wire string', () async {
    await initVariants();
    final value = await Toggly.getDateTimeValue('DateTimeFlag');
    expect(value, DateTime.utc(2026, 1, 15, 10));
  });

  test('getDateTimeValue soft-nulls a string-typed flag', () async {
    await initVariants();
    expect(await Toggly.getDateTimeValue('StringFlag'), isNull);
  });

  test('typed getters soft-null when the feature is disabled', () async {
    await initVariants();
    expect(await Toggly.getStringValue('Disabled'), isNull);
  });

  test('typed getters soft-null for an unknown feature key', () async {
    await initVariants();
    expect(await Toggly.getStringValue('Missing'), isNull);
    expect(await Toggly.getNumberValue('Missing'), isNull);
    expect(await Toggly.getJsonValue('Missing'), isNull);
    expect(await Toggly.getDateTimeValue('Missing'), isNull);
  });

  test('typed getters attempt a decode when no valueType is declared',
      () async {
    await initVariants();
    expect(await Toggly.getStringValue('Legacy'), 'no-declared-type');
  });
}

class Checkout {
  Checkout({required this.color});
  final String color;
  factory Checkout.fromJson(Map<String, dynamic> json) =>
      Checkout(color: json['color'] as String);
}
