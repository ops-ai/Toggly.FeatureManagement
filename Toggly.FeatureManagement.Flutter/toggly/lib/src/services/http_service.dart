import 'package:dio/dio.dart';
import 'package:dio_smart_retry/dio_smart_retry.dart';

/// Simple [Dio] wrapper to simplify http requests across the package.
class HttpService {
  static final HttpService _instance = HttpService._internal();

  /// Actual [Dio] instance.
  late Dio http;

  HttpService._internal() {
    http = Dio();

    http.interceptors.add(RetryInterceptor(
      dio: http,
      logPrint: print,
      retries: 1,
      retryDelays: const [
        Duration(milliseconds: 300),
        Duration(milliseconds: 600),
        Duration(milliseconds: 900),
        Duration(milliseconds: 1200),
        Duration(milliseconds: 1500),
      ],
    ));
  }

  /// Returns the singleton [HttpService] instance
  static HttpService get getInstance => _instance;
}
