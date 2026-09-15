# Physical iPad secure-storage probe

This fixture is a disposable iOS application entrypoint for OPS-1187. It is
outside the published adapter. It uses the real plugin and native Keychain;
there are no mocked storage channels. `AppDelegate.swift` only exposes a
boolean Keychain accessibility check and identifier-free console messages.

Use a dedicated app identifier, the same signing identity, and the same
`IOSOptions` namespace through the entire run. Never uninstall, clear app data,
or change the namespace between version checkpoints. Seed exact plugin
**9.2.4**, install **10.3.3** over it, then install **11.1.1** over that. Launch
and restart each version. Do not apply Android-specific migration options to
this iOS fixture. This tests iOS Keychain continuity across plugin upgrades;
it does not establish Android cipher migration behavior.

## Host preparation

Generate a disposable host with `flutter create --platforms=ios`. Copy
`main.dart` to its `lib/main.dart` and `AppDelegate.swift` to
`ios/Runner/AppDelegate.swift`. Resolve the candidate adapter archive and exact
public `feature_flags_toggly: 1.11.1`, with one exact plugin version at a time.
The recorded run served a runtime archive of the candidate's `lib`, manifest,
README, changelog, and license on a loopback Pub endpoint; the host used no
source dependency or dependency override. Preserve the archive digest and each
resolved lock. This is local candidate artifact evidence, not public release
installation evidence.

For the recorded Flutter 3.44.4 / Xcode 27 host, set the generated Runner and
Pods deployment targets to iOS 15.0 (the installed Xcode rejects generated
9.0/13.0 targets). This is a disposable host setting, not a change to the SDK's
declared support floor. Add `NSAppTransportSecurity/NSAllowsLocalNetworking`
with value `true` to the host Info.plist; its HTTP fixture binds only to the
physical device's loopback address.

For each plugin version, resolve with `flutter pub get`, analyze `lib`, then:

```sh
flutter build ios --release --no-codesign --dart-define=PROBE_STAGE=9
xcodebuild -workspace ios/Runner.xcworkspace -scheme Runner \
  -derivedDataPath DerivedData -configuration Release -sdk iphoneos \
  -destination "id=$IPAD_UDID" -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  "DEVELOPMENT_TEAM=$SIGNING_TEAM" CODE_SIGN_STYLE=Automatic build
xcrun devicectl device install app --device "$IPAD_DEVICE" \
  DerivedData/Build/Products/Release-iphoneos/Runner.app
xcrun devicectl device process launch --device "$IPAD_DEVICE" \
  --terminate-existing --console --timeout 90 "$PROBE_APP_ID"
```

Repeat the launch command for the separate process restart, then repeat the
resolve/build/install/launch sequence with `PROBE_STAGE=10` and `11`. The
signed `DerivedData` app must be installed; Flutter's earlier `--no-codesign`
output is intentionally unsigned. Keep device identifiers and signing metadata
in private local environment values, and filter them from retained logs.

The probe waits for the real `resumed` lifecycle before calling Toggly. Its
seeding marker is written before assertions so a failed assertion cannot
reseed existing keys on a retry. Upgrade stage markers advance only after all
checks pass. Each successful run prints `IPAD_PASS:stage=N:launch=M`, with
launch counts increasing across app process exits and all three installations.

## Assertions and boundaries

- Injected instance, exact durable keys, flags/variants and signature metadata,
  JWKS, LRU, unrelated host value, identity isolation, scoped deletion.
- Existing legacy revision migrates to the identity-specific key.
- Native `SecItemCopyMatching` confirms the fixture item is
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`; the plugin reads/writes real
  Keychain data across process restarts. This is protected Keychain persistence
  evidence, not extraction of encrypted system Keychain files or independent
  hardware encryption certification.
- Malformed flags/variants remain byte-for-byte present after returning cache
  misses. A write using an unauthorized Keychain access group throws a real
  platform exception and leaves the original JWKS value intact.
- Toggly initializes from an on-device HTTP fixture, respects closed/open local
  gates, refreshes changed flags, and stops polling after `dispose()`. The
  fixture disables signed definitions explicitly; retained signature metadata
  checks do not represent runtime signature-verification coverage.

The app exits after each completed probe. It has no production credentials and
contacts no Toggly production endpoint. App process restart is tested; physical
device reboot, locked-device behavior, iCloud synchronization, biometrics,
macOS, minimum supported iOS/Flutter versions, and Android are separate scopes.
