// Legacy interop keeps the declared Dart 2.18 floor; isolated by conditional import.
// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter
import 'dart:async';
import 'dart:convert';
import 'dart:html' as html;
import 'dart:js' as js;
import 'dart:typed_data';

/// Credential-free fetch with browser-native compression and bounded exits.
class BrowserTelemetryTransport {
  StreamSubscription<html.Event>? _visibility;
  StreamSubscription<html.Event>? _pageHide;
  bool _hidden = false;
  bool get available => true;
  js.JsObject? _activeController;
  void cancel() => _activeController?.callMethod('abort');

  void bind(void Function() onExit) {
    if (js.context['fetch'] is! js.JsFunction) return;
    _visibility = html.document.onVisibilityChange.listen((_) {
      if (html.document.visibilityState == 'hidden') {
        if (!_hidden) {
          _hidden = true;
          onExit();
        }
      } else {
        _hidden = false;
      }
    });
    _pageHide = html.window.onPageHide.listen((_) {
      if (!_hidden) {
        _hidden = true;
        onExit();
      }
    });
  }

  void dispose() {
    _visibility?.cancel();
    _visibility = null;
    _pageHide?.cancel();
    _pageHide = null;
  }

  Future<dynamic> _promise(js.JsObject promise) {
    final result = Completer<dynamic>();
    promise.callMethod('then', [
      js.JsFunction.withThis((_, dynamic value) {
        result.complete(value);
      }),
      js.JsFunction.withThis((_, dynamic error) {
        result.completeError(StateError('Browser transport failed'));
      }),
    ]);
    return result.future;
  }

  Future<Map<String, dynamic>> send(Uri endpoint, Uint8List body,
      {required bool Function() exit,
      required bool Function() cancelled,
      required Duration timeout}) async {
    final elapsed = Stopwatch()..start();
    final abort = js.context['AbortController'];
    final controller = abort is js.JsFunction ? js.JsObject(abort) : null;
    _activeController = controller;
    var expired = false;
    final timer = Timer(timeout, () {
      expired = true;
      controller?.callMethod('abort');
    });
    try {
      dynamic payload = utf8.decode(body);
      var compressed = false;
      final compression = js.context['CompressionStream'];
      if (!exit() && compression is js.JsFunction) {
        try {
          final blob = js.JsObject.fromBrowserObject(html.Blob([body]));
          final stream = blob.callMethod('stream') as js.JsObject;
          final compressor = js.JsObject(compression, ['gzip']);
          final zipped = stream.callMethod('pipeThrough', [compressor]);
          final response = js.JsObject(js.context['Response'], [zipped]);
          payload = await _promise(response.callMethod('arrayBuffer'))
              .timeout(timeout);
          compressed = true;
        } catch (_) {
          // Fall back before any request, never resend an ambiguous send.
        }
      }
      if (expired) throw TimeoutException('telemetry_timeout');
      if (cancelled()) throw StateError('telemetry_disposed');
      if (exit()) {
        payload = utf8.decode(body);
        compressed = false;
      }
      final options = js.JsObject.jsify({
        'method': 'POST',
        'credentials': 'omit',
        'mode': 'cors',
        'redirect': 'error',
        'keepalive': exit(),
        'headers': {
          'Content-Type': 'application/json',
          if (compressed) 'Content-Encoding': 'gzip'
        },
      });
      options['body'] = payload;
      if (controller != null) options['signal'] = controller['signal'];
      final response = await _promise(
              js.context.callMethod('fetch', [endpoint.toString(), options]))
          .timeout(timeout - elapsed.elapsed);
      return {
        'status': response['status'],
        'retryAfter': response['headers'].callMethod('get', ['retry-after'])
      };
    } finally {
      timer.cancel();
      _activeController = null;
    }
  }
}
