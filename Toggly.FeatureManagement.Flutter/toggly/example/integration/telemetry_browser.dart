// A compiled Flutter host for the loopback collector integration check.
// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter
import 'dart:async';
import 'dart:html' as html;
import 'dart:js' as js;
import 'package:flutter/widgets.dart';
import 'package:feature_flags_toggly/feature_flags_toggly.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final base = html.window.location.origin;
  final metrics = Uri.base.queryParameters['metrics'] ?? base;
  await Toggly.init(
      appKey: 'loopback-key',
      identity: 'alice',
      instanceId: 'loopback-token',
      useSignedDefinitions: false,
      config: TogglyConfig(
          baseURI: base, metricsBaseUrl: metrics, enableLiveUpdates: false));
  js.context['telemetryCommand'] = js.JsFunction.withThis((_, String action) {
    js.context['telemetryStatus'] = 'working';
    Future<void> work() async {
      switch (action) {
        case 'normal':
          Toggly.incrementCounter('normal');
          await Toggly.flushTelemetry();
          break;
        case 'fallback':
          await Toggly.setInstanceId(null);
          Toggly.incrementCounter('fallback');
          await Toggly.flushTelemetry();
          break;
        case 'queue':
          for (var i = 0; i < 150; i++) {
            Toggly.recordUsage('exit-$i');
          }
          break;
        case 'dispose':
          Toggly.dispose();
          break;
        case 'after':
          Toggly.incrementCounter('after-dispose');
          await Toggly.flushTelemetry();
          break;
      }
    }

    unawaited(work().then((_) => js.context['telemetryStatus'] = 'done'));
  });
  js.context['telemetryStatus'] = 'ready';
  runApp(const Directionality(
      textDirection: TextDirection.ltr,
      child: Text('Loopback telemetry host')));
}
