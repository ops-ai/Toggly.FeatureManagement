# Public Apple telemetry acceptance host

This is a narrow acceptance fixture for the released Swift package, not a
teaching Sample. The Xcode project resolves
`https://github.com/ops-ai/Toggly.FeatureManagement.git` at signed tag
`ios-sdk-v1.6.0`; the committed `Package.resolved` pins
`a657a71b2ea8088c3d2acb833825c9c6577d0b40`. It has no local Swift
package path, application key, signing identity, or production telemetry URL.
All values are synthetic and the collector binds only `127.0.0.1:8766`.

From the repository root, with Xcode installed:

```sh
project=Toggly.FeatureManagement.iOS/acceptance/PublicAppleHost/PublicAppleHost.xcodeproj
xcodebuild -resolvePackageDependencies -project "$project" -scheme PublicAppleHost-iOS
xcodebuild -project "$project" -scheme PublicAppleHost-iOS -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project "$project" -scheme PublicAppleHost-macOS -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build
```

For native HTTP evidence, run the collector in one terminal:

```sh
python3 Toggly.FeatureManagement.iOS/acceptance/PublicAppleHost/collector.py --output /tmp/apple-packets.jsonl
```

Build for an installed iOS
simulator and use `xcrun simctl install booted <built-app-path>`, followed by
`xcrun simctl launch booted io.opsai.toggly.publicapplehost`. The main run
checks direct and negated flags, any-gate, local and mapped entity context,
SwiftUI `FeatureFlag`/`FeatureView`, UIKit `FeatureFlagAsync`, and a Combine
publisher. It explicitly records usage, view, counter, and gauge, then flushes.
The screen prints the evaluated results. Launch options are:

| Option | Exercise |
| --- | --- |
| `--variants` | Public 1.6.0 variant endpoint and `FeatureVariant` wrapper |
| `--identity` | Replace user identity, refresh, and flush new attribution |
| `--dispose` | Record a final view and dispose; final packet is plain JSON |
| `--keyless` | Omit app key; no definition or telemetry request |
| `--optout` | Disable telemetry; definition fetch still occurs |
| `--pending-background` | Queue usage after flush; switch to Safari to trigger real scene background flush, then return for refresh |

Run one option set per launch with
`xcrun simctl launch --terminate-running-process booted io.opsai.toggly.publicapplehost <options>`.
The collector accepts `--mode retry429`, `retry503`, or `ambiguous`. The first
two modes respond with one explicit failure status and then `202`, so leave the
app active for over 30 seconds to observe its retry. `ambiguous` reads the
body and closes without a response; leave it active past that window to check
that the original event is not replayed. Stop and restart the collector between
modes. The JSONL witness records decoded gzip or plain bodies, path, status,
and Origin/Authorization/Cookie presence. It does not log all headers or
store a credential.
Use `verify_capture.py <mode> <capture.jsonl>` for baseline, variant,
retry429, retry503, ambiguous, or silent assertions on a capture from one run.

This fixture does not resolve the ingestion policy for optional `i` or `u`
fields. Its local simulator packets are not deployed/live ingestion proof.
