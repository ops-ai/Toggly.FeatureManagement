import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_test/flutter_test.dart';
import 'package:feature_flags_toggly/src/services/sdk_identity.dart';

void main() {
  test('SDK HTTP metadata preserves host headers', () {
    final headers = sdkHttpHeaders({'Authorization': 'Bearer test'});

    expect(headers['Authorization'], 'Bearer test');
    if (kIsWeb) {
      expect(headers['X-Toggly-Sdk'], sdkId);
      expect(headers['X-Toggly-Sdk-Version'], sdkVersion);
    } else {
      expect(headers['User-Agent'], sdkUserAgent());
    }
  });

  test('WebSocket query encodes an opaque revision and omits an empty one', () {
    const revision = 'rev/with spaces&equals=1';
    final params = Uri.splitQueryString(
      appendSdkQueryString(cachedRevision: revision),
    );

    expect(params, {
      'sdk': sdkId,
      'sdkVersion': sdkVersion,
      'rev': revision,
    });
    expect(Uri.splitQueryString(appendSdkQueryString(cachedRevision: '')),
        isNot(contains('rev')));
  });
}
