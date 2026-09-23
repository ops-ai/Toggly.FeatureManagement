# OPS-1387 public Flutter acceptance host

This isolated iOS/Android app pins `feature_flags_toggly: 1.12.0` from pub.dev.
`pubspec.lock` carries the hosted URL and SHA-256. No path, Git, or dependency
package override is used. The SDK repository example is source evidence only.

Run `flutter pub get`, `flutter analyze`, `flutter test`,
`flutter build ios --simulator --no-codesign`, and `flutter build apk --debug`.
For simulator execution, start `python3 tool/collector.py --port 18765`
and run `flutter run -d <device> --dart-define=DEFINITIONS_URL=http://127.0.0.1:18765 --dart-define=METRICS_URL=http://127.0.0.1:18765`
on iOS. For the Android emulator use `10.0.2.2` in both URLs. Pass `--dart-define=AUTO_PROBE=true` for automated launch or tap
**Run local probe**. Both URLs must point to this local collector; the app embeds only a synthetic fixture key and no production telemetry endpoint.
The Debug simulator architecture is pinned to arm64 for this Apple Silicon/Xcode 27
host; the default multi-architecture setting caused Flutter 3.44.4 to pass
`arm64 x86_64` as one architecture to `lipo`.

The fixture key and identity values are synthetic. `tool/collector.py` serves
real ephemeral P-256 signed flags/variants and JWKS; its private key remains
outside the candidate. The app shows the resolved sync, async gate, negation,
and variant result; the collector records packets. The fixture signs definitions
only and does not mint a production instance token.

The test host captures native HTTP requests, decodes gzip/plain bodies, and
checks compact fields, explicit events, keyless/opt-out, attribution changes,
lifecycle and disposal. The public facade retry probe uses its real 30/60-second
backoff; no production POST is required.
