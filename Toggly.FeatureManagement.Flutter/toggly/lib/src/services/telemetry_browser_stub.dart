import 'dart:typed_data';

/// No browser imports or lifecycle work on native hosts.
class BrowserTelemetryTransport {
  bool get available => false;
  void bind(void Function() onExit) {}
  void dispose() {}
  void cancel() {}
  Future<Map<String, dynamic>> send(Uri endpoint, Uint8List body,
          {required bool Function() exit,
          required bool Function() cancelled,
          required Duration timeout}) =>
      throw UnsupportedError('Browser transport unavailable');
}
