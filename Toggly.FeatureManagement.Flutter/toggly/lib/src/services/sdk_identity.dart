import 'package:flutter/foundation.dart' show kIsWeb;

const String sdkId = 'flutter';
const String sdkVersion = '1.5.1';

String sdkUserAgent() => 'toggly-$sdkId/$sdkVersion';

Map<String, String> sdkCustomHeaders() => {
      'X-Toggly-Sdk': sdkId,
      'X-Toggly-Sdk-Version': sdkVersion,
    };

Map<String, dynamic> sdkHttpHeaders([Map<String, dynamic>? existing]) {
  final headers = <String, dynamic>{...?existing};
  if (kIsWeb) {
    headers.addAll(sdkCustomHeaders());
  } else {
    headers['User-Agent'] = sdkUserAgent();
  }
  return headers;
}

String appendSdkQueryString({String? cachedRevision}) {
  final params = <String, String>{
    'sdk': sdkId,
    'sdkVersion': sdkVersion,
  };
  if (cachedRevision != null && cachedRevision.isNotEmpty) {
    params['rev'] = cachedRevision;
  }
  return Uri(queryParameters: params).query;
}
