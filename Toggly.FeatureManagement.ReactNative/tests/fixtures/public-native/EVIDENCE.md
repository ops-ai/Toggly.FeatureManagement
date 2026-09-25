# OPS-1381 public native consumer evidence

Candidate tree: `Toggly.FeatureManagement.ReactNative/tests/fixtures/public-native/`
on branch `alex/ops-1381-rn-public-hermes`. **Candidate SHA is recorded at the bottom
after the freeze commit.**

## Published packages (clean registry lock)

`npm ci` resolves only from `https://registry.npmjs.org/` (no `file:`/`link:`/
workspace alias, no forced peers, no `react-native-url-polyfill`):

| Package | Version | Integrity (sha512) |
|---|---|---|
| `@ops-ai/react-native-toggly` | 1.5.0 | `ffzQ2Yq9rrM3Fh5TyR8+NhZ0t+05Abu5ZIzLyn3hG28+s70oE7wrAxU3vZ0xAlRqihAlCd9peMjLLJ5DXIisHg==` |
| `@ops-ai/react-native-toggly-core` | 1.9.1 | `iLUrSfJZIt9XldO7aDzjXbMIlDEjT8BXMYSn1AFsn9OJvc1Qx6NvJasY1QFsJK8eP6fEDWV0uk0QVugl4BA01w==` |
| `@ops-ai/react-native-toggly-storage-mmkv4` | 1.0.0 | `bJMWJ9GFyzGUsaXESutdlWl3Ulsm6NohoAuBcPoFe8/OULnh+GINfTQV0eTXQeeOsQRY+uGoVeek77WiK62fWA==` |
| `@ops-ai/toggly-client-telemetry` | 1.1.1 | `+Hub75lrc2V2Wc+v9J3ZgrIMlcMoNyLh+VzJCyHga9wug/rpyRm3zHqlIxOo17Ti93wIxmsZsocG0o5aCJQxBw==` |
| `react-native` | 0.87.1 | `DJKG6ANoD7BtrE4z9DewiSD7/RxCX73lK5Pu49aUr85P3333Dm2roTiP0rRjQNDZdVizHSOmstWfwF/o9EjCRA==` |
| `react` | 19.2.3 | `Ku/hhYbVjOQnXDZFv2+RibmLFGwFdeeKHFcOTlrt7xplBnya5OGn/hIRDsqDiSUcfORsDC7MPxwork8jBwsIWA==` |
| `react-native-mmkv` | 4.3.2 | `49OAyfkg0/TMWiWELZN6VuVQPZPhizwL4DTmp8b7B1md3dB/s3LH3mGfC3T+lp9W0y/rqxZMEnotLFTIbOAenQ==` |
| `react-native-nitro-modules` | 0.37.1 | `KpW6EQVQ/bfegpCGxN9Be+ndvsfj56t4IESEvCASu9gWpJa/NDfHpIeIwCOvZQ3eXmLEj6YD4wCLqcC1FJPr2w==` |

Core 1.9.1 + telemetry 1.1.1 include the OPS-1392 Hermes-safe URL construction
(full URL string build; no reliance on `URL.pathname` assignment).

## Hosted CI vs local native

| Gate | Where |
|---|---|
| `npm ci`, typecheck, lint, Jest, Metro `bundle:ios` / `bundle:android`, registry integrity check | Hosted: `.github/workflows/react-native-public-consumer.yml` |
| Stock Hermes iOS 18.x simulator + Android API 35 emulator collector proof | Local only (this EVIDENCE) |

## JavaScript verification (exit 0)

From the fixture directory:

```text
npm ci                         # exit 0
npm run typecheck              # exit 0
npm run lint                   # exit 0
npm test -- --runInBand --detectOpenHandles   # exit 0 (5 tests)
npm run bundle:ios             # exit 0
npm run bundle:android         # exit 0
```

## Stock Hermes — iOS 18.4 simulator

- Device: iPhone 16 Pro (`7DDAC8CA-0E95-4096-9A72-812C217FAA66`), iOS 18.4
- Build: `xcodebuild` Debug with `CLANG_ENABLE_EXPLICIT_MODULES=NO` /
  `SWIFT_ENABLE_EXPLICIT_MODULES=NO` (Xcode 27 CocoaPods symlink scan)
- Runtime: Metro 0.87.1 + stock Hermes; **no** `react-native-url-polyfill`
- UI: `direct:true`, `negatedAll:true`, `shortCircuit:false`, `local:false`, `entity:true`

Collector transcript (`/tmp/ops1381-proof-collector.log`):

```text
GET /evaluated-signed/sample-key-a/Acceptance?i=sample-instance-a
POST /api/frontend/telemetry
{"packet":{"k":"sample-key-a","e":"Acceptance","i":"sample-instance-a","f":{"DirectOn":{"enabled":[2],"sample":[0,1,1]},"DirectOff":{"disabled":[2]},"LocalOn":{"disabled":[1]},"OrderGate":{"enabled":[1]}},"m":{"orders":2,"cart":3.5}},"contentEncoding":"plain","forbiddenHeaders":[]}
GET /evaluated-signed/sample-key-a/Acceptance?u=sample-user-c
POST /api/frontend/telemetry
{"packet":{"k":"sample-key-a","e":"Acceptance","u":"sample-user-c","f":{"DirectOn":{"enabled":[1]}}},"contentEncoding":"plain","forbiddenHeaders":[]}
```

Never bare `GET /` or `POST /` from the SDK. No Origin/Cookie/Authorization.
No production `metrics.toggly.io` POST.

## Stock Hermes — Android API 35 emulator

- AVD: `Medium_Phone_API_35` (API 35, arm64)
- Build: `./gradlew :app:assembleDebug` (exit 0); MMKV/Nitro native libs linked
- Runtime: embedded Metro bundle for install stability + stock Hermes; **no** polyfill
- `adb reverse tcp:8765 tcp:8765`; UI matched iOS evaluation line

Collector transcript (`/tmp/ops1381-proof-collector-android.log`):

```text
GET /evaluated-signed/sample-key-a/Acceptance?i=sample-instance-a
POST /api/frontend/telemetry
{"packet":{"k":"sample-key-a","e":"Acceptance","i":"sample-instance-a","f":{"DirectOn":{"enabled":[2],"sample":[0,1,1]},"DirectOff":{"disabled":[2]},"LocalOn":{"disabled":[1]},"OrderGate":{"enabled":[1]}},"m":{"orders":2,"cart":3.5}},"contentEncoding":"plain","forbiddenHeaders":[]}
GET /evaluated-signed/sample-key-a/Acceptance?u=sample-user-c
POST /api/frontend/telemetry
{"packet":{"k":"sample-key-a","e":"Acceptance","u":"sample-user-c","f":{"DirectOn":{"enabled":[1]}}},"contentEncoding":"plain","forbiddenHeaders":[]}
```

(Later `GET /` / `GET /json/version` lines are emulator/Chrome DevTools probes, not SDK.)

## Limits

- Jest covers AppState background/inactive via a synthetic subscriber; live device
  background/inactive/resume was not independently captured on simulator/emulator.
- Provider replacement, MMKV key inspection, and post-disposal transport were not
  re-captured on-device beyond the automatic init + identity flush path.
- iOS Debug under Xcode 27 needs `CLANG_ENABLE_EXPLICIT_MODULES=NO` for NitroMmkv/
  MMKVCore CocoaPods header symlinks.
- Hosted CI does not run Xcode/Android emulator for this fixture.

## Candidate SHA

`d4083dacde769a601459317cd971e36111da587c` (signed freeze that added this fixture;
subsequent tip commits may only amend this evidence pointer).
