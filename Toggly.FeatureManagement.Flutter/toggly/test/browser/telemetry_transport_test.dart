// Legacy interop intentionally matches the package Dart floor.
// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter
@TestOn('browser')
library telemetry_browser_test;

import 'dart:async';
import 'dart:convert';
import 'dart:html' as html;
import 'dart:js' as js;
import 'package:feature_flags_toggly/src/services/telemetry_reporter.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('browser retry statuses preserve identity and bounded backoff',
      () async {
    final original = js.context['fetch'];
    final compression = js.context['CompressionStream'];
    final sent = <String>[];
    final waits = <Duration>[];
    var calls = 0;
    js.context['CompressionStream'] = null;
    js.context['fetch'] = js.JsFunction.withThis((_, url, options) {
      sent.add(options['body']);
      calls++;
      return js.context['Promise'].callMethod('resolve', [
        js.JsObject.jsify({
          'status': calls < 3 ? 503 : 202,
          'headers': {'get': js.JsFunction.withThis((_, name) => null)}
        })
      ]);
    });
    final reporter = TelemetryReporter(
        appKey: 'key',
        identity: 'alice',
        delay: (d) async {
          waits.add(d);
        });
    try {
      reporter.incrementCounter('orders');
      await reporter.flushTelemetry();
      expect(sent, hasLength(3));
      expect(sent.toSet(), hasLength(1));
      expect(jsonDecode(sent.first)['u'], 'alice');
      expect(waits, [const Duration(seconds: 30), const Duration(seconds: 60)]);
    } finally {
      reporter.dispose();
      js.context['fetch'] = original;
      js.context['CompressionStream'] = compression;
    }
  });

  test('opt-out and keyless reporters never send or flush on pagehide',
      () async {
    final original = js.context['fetch'];
    var calls = 0;
    js.context['fetch'] = js.JsFunction.withThis((_, url, options) {
      calls++;
      throw StateError('unexpected fetch');
    });
    final disabled = TelemetryReporter(appKey: 'key', enableTelemetry: false);
    final keyless = TelemetryReporter(appKey: null);
    try {
      disabled.incrementCounter('x');
      keyless.incrementCounter('x');
      html.window.dispatchEvent(html.Event('pagehide'));
      await disabled.flushTelemetry();
      await keyless.flushTelemetry();
      expect(calls, 0);
    } finally {
      disabled.dispose();
      keyless.dispose();
      js.context['fetch'] = original;
    }
  });

  test('disposal during compression sends one plain keepalive envelope',
      () async {
    final originalFetch = js.context['fetch'];
    final originalResponse = js.context['Response'];
    final sent = <js.JsObject>[];
    final started = Completer<void>();
    late js.JsFunction finish;
    final promise = js.JsObject(js.context['Promise'], [
      js.JsFunction.withThis((_, resolve, reject) {
        finish = resolve;
      })
    ]);
    js.context['Response'] =
        js.JsFunction.withThis((_, stream) => js.JsObject.jsify({
              'arrayBuffer': js.JsFunction.withThis((_) {
                started.complete();
                return promise;
              })
            }));
    js.context['fetch'] = js.JsFunction.withThis((_, url, options) {
      sent.add(options);
      return js.context['Promise'].callMethod('resolve', [
        js.JsObject.jsify({
          'status': 202,
          'headers': {'get': js.JsFunction.withThis((_, name) => null)}
        })
      ]);
    });
    final reporter = TelemetryReporter(appKey: 'key');
    try {
      reporter.incrementCounter('final');
      final sending = reporter.flushTelemetry();
      await started.future;
      reporter.dispose();
      finish.apply([
        js.JsObject(js.context['ArrayBuffer'], [4])
      ]);
      await sending;
      expect(sent, hasLength(1));
      expect(sent.single['keepalive'], true);
      expect(sent.single['headers']['Content-Encoding'], isNull);
      expect(jsonDecode(sent.single['body'])['m'], {'final': 1});
    } finally {
      reporter.dispose();
      js.context['fetch'] = originalFetch;
      js.context['Response'] = originalResponse;
    }
  });

  test('browser sends credential-free fetch and plain bounded exit requests',
      () async {
    final original = js.context['fetch'];
    final sent = <js.JsObject>[];
    js.context['fetch'] = js.JsFunction.withThis((_, url, options) {
      sent.add(options);
      return js.context['Promise'].callMethod('resolve', [
        js.JsObject.jsify({
          'status': 202,
          'headers': {'get': js.JsFunction.withThis((_, name) => null)}
        })
      ]);
    });
    final reporter =
        TelemetryReporter(appKey: 'test-key', instanceId: 'minted');
    try {
      reporter.incrementCounter('normal');
      await reporter.flushTelemetry();
      reporter.incrementCounter('exit');
      html.window.dispatchEvent(html.Event('pagehide'));
      await reporter.flushTelemetry();
      expect(sent, hasLength(2));
      for (final options in sent) {
        expect(options['credentials'], 'omit');
      }
      final last = sent.last;
      expect(last['keepalive'], true);
      final body = last['body'] as String;
      expect(utf8.encode(body).length, lessThanOrEqualTo(49152));
      expect(jsonDecode(body)['i'], 'minted');
      expect(last['headers']['Content-Encoding'], isNull);
      reporter.dispose();
      html.window.dispatchEvent(html.Event('pagehide'));
      await Future<void>.delayed(Duration.zero);
      expect(sent, hasLength(2));
    } finally {
      reporter.dispose();
      js.context['fetch'] = original;
    }
  });
}
