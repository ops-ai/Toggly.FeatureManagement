# Android public telemetry acceptance fixture (OPS-1388)

This standalone fixture resolves the published Maven Central `io.toggly` Core,
Compose, Views, Room and DataStore artifacts at 1.8.0. It has its own generated
Gradle lock and no project modules, local Maven repository, dependency
substitution or SDK source references. It is a test host, not a teaching sample.

With Android SDK and Java 17 installed, run:

```sh
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest
./gradlew :app:connectedDebugAndroidTest
```

The instrumentation suite checks direct/negated/any/all and entity evaluations,
Compose and Views adapters, variants, Room/DataStore use, explicit events,
identity replacement, keyless/opt-out, and credential-free localhost packets.
It uses MockWebServer and never calls production.

For a separately observed signed app on the Android emulator, start the HTTP/1.1
loopback collector and launch the app with an explicit endpoint:

```sh
python3 tool/collector.py --port 18765 --output /private/tmp/ops1388-packets.jsonl
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n io.toggly.acceptance.telemetry/io.toggly.acceptance.AcceptanceActivity \
  --es endpoint http://10.0.2.2:18765 --ez runProbe true
adb shell input keyevent 4 # Back: dispose the activity and send one plain final packet
python3 tool/assert_packets.py < /private/tmp/ops1388-packets.jsonl
```

The app accepts only explicit `10.0.2.2`/`127.0.0.1` HTTP endpoints and logs
`PUBLIC_ANDROID_API_PROBE_PASS` when its public API checks finish. The separate
packet assertion verifies that both pre/post replacement events reached the
collector; an app log alone is not telemetry delivery proof. The collector
generates ephemeral signing keys and prints no secrets. Keep each capture in a
fresh file because the JSONL output is append-only. Background/resume can be
exercised with Home then an `am start`; Back disposes the activity's clients.
For an ambiguity diagnostic, start a fresh collector with `--ambiguous-first`.
It reads and records the first POST, then closes without a response. Leave the
app and collector running at least 32 seconds before checking that the first
packet body appears once; later packets have distinct post-replacement context.

The approved compact wire contract permits optional `i` or `u` alongside
`k/e/f/m`, never both. The fixture records actual attribution fields. The public
Android Core API has no local-gate registration seam; the test exercises the
published remote gates and records that limit explicitly.
