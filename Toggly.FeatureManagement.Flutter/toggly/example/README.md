# Flutter example

This host demonstrates `feature_flags_toggly`. Run `flutter pub get`, then
`flutter run` for your selected target.

The iOS example targets **iOS 15 or later** for compatibility with current Xcode.
This is the example host target; package Dart/Flutter constraints are unchanged.
Building this example does not verify older iOS versions. It uses only Dart
dependencies, so it does not reference a generated native plugin registrant.
If adding a native Flutter plugin, restore the plugin registration produced
by the Flutter host template.

Local platform checks:

```sh
flutter pub get
flutter build web
flutter build apk --debug
cd ios && pod install && cd ..
flutter build ios --debug --no-codesign
```

The unsigned iOS command verifies compilation only; running on a device requires
normal signing and provisioning.

## Browser telemetry collector check

The integration host uses only synthetic data and loopback URLs. From this
example directory:

```sh
flutter build web --target=integration/telemetry_browser.dart --no-web-resources-cdn
python3 ../tool/telemetry_collector.py build/web
```

Run `../tool/verify_telemetry_browser.js` as an async Playwright page function
(e.g. the Playwright `browser_run_code_unsafe` file runner). It verifies real
fetch requests against the collector on ports 18765/18766: same-origin cookies
are omitted, cross-origin preflight succeeds, ordinary gzip/plain bodies carry
the expected identity, hidden/pagehide share one plain keepalive flush, and
disposal prevents further sends. The fetch observer forwards to native fetch;
it does not replace the transport or return fabricated responses.
