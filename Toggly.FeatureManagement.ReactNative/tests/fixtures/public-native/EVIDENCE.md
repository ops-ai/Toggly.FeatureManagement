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


---

## 2026-10-19 UTC — OPS-1914 public-package refresh

The complete OPS-1381 record above is retained unchanged and describes its
original package versions and native runs. This section records a fresh public
consumer install after OPS-1898 publication; it does not extend the historical
native execution claim to the new versions.

Branch: `alex/ops-1914-rn-public-fixture`. Freshly fetched base:
`a3b18574211ee483ea228757a6dc1135f6ae46e2`. Candidate is the signed commit
containing this appended section; its SHA is supplied in the Oracle handoff.
Plan: `Toggly.wiki/Home/Engineering/Plans/2026-10-19-React-Native-Public-Fixture-Implementation.md`.

### Fresh official registry and dependency graph

Registry metadata was independently fetched from `https://registry.npmjs.org/`
at kickoff and every locked `@ops-ai` URL/integrity was compared again at
`2026-10-19T00:29:51.748Z`. Core 1.11.1 was publicly published at
`2026-10-19T00:19:19.125Z` and requires reporter `^1.3.0`.

| Package | Installed version | Official registry integrity |
|---|---|---|
| `@ops-ai/react-native-toggly` | 1.6.1 | `sha512-cnctrkVgMAEf9KwKShjGhk66XZwV/0ht7p7B9uT6WlEdo3jYqeLLu0ftHG+l63GPQ3dHS2tpht8Vrve+2Yt33g==` |
| `@ops-ai/react-native-toggly-core` | 1.11.1 | `sha512-3FGxzoiMoDBMkKvbRq16dtYqkxo9PFXZh9Yv1ZFmXNXYa47gX93SlrduXOwOuqy13ELn1Wqhqq9BME9YxrHpng==` |
| `@ops-ai/react-native-toggly-storage-mmkv4` | 1.0.0 | `sha512-bJMWJ9GFyzGUsaXESutdlWl3Ulsm6NohoAuBcPoFe8/OULnh+GINfTQV0eTXQeeOsQRY+uGoVeek77WiK62fWA==` |
| `@ops-ai/toggly-client-telemetry` | 1.3.0 | `sha512-4rsDN5AJFW8cjz+h6zZow8SsB+8ymneQrwNgOmWOyn+GyS0rMSriWN2Pmgsj3INGfBwFTSS4C/Dq6uMJwp6ZsA==` |
| `@ops-ai/toggly-hooks-types` | 1.4.5 | `sha512-fc9y8MQsWiF3oXWnPlkuFnv9RYl6d+YNIUCGPmpn/e80reMydw2kXkzYuHt3vgtCZbdIInyeQctQFH0w8Psg3Q==` |
| `@ops-ai/toggly-local-gates` | 1.0.2 | `sha512-nKomiH1AALYR235MfuA1ExhNXjy++rpA1DjYMEUk5lfjnbzDVzstuHqrnh9J48rx1EQNeFLC18KgfVZDyfeYxA==` |
| `@ops-ai/toggly-signed-defs` | 1.2.9 | `sha512-jGk5mBTNsLoZf8sQMiDFGd2iQslFEPF3oAaSUnKMi12sLiOKQYfHqm/+y/tNYPb1RBPhqpcmsP1uFlztpN/KQA==` |

`npm ls @ops-ai/react-native-toggly-core @ops-ai/toggly-client-telemetry --all`
exited 0: adapter 1.6.1 (Core `^1.10.0`) and MMKV4 adapter 1.0.0 (Core
`^1.7.4`) deduplicate to one Core 1.11.1; it owns one reporter 1.3.0.
All 873 lock entries resolve to official registry HTTPS tarballs and have
SHA-512 integrities. No linked/workspace/source overrides, forced or legacy
peers, fabricated integrity, or URL polyfill were used. An ordinary
`npm install --package-lock-only --registry=https://registry.npmjs.org/`
generated the lock before a clean `npm ci`. Only adapter, Core and reporter
versions changed; all third-party package versions and host pins remain intact.

### Fresh JavaScript and Metro verification

Final commands used Node `v24.19.0` and npm `10.2.3`, explicitly prepending
`/Users/alexandrupuiu/.nvm/versions/node/v24.19.0/bin` to PATH. An earlier
install attempt selected Node 20 in the shell; normal lock generation and the
clean install were repeated with the supported Node runtime before final checks.

| Command (from fixture directory) | Exit/result |
|---|---|
| `npm install --package-lock-only --registry=https://registry.npmjs.org/` | 0 |
| `npm ci --registry=https://registry.npmjs.org/` | 0; fresh 873 packages |
| `npm ls @ops-ai/react-native-toggly-core @ops-ai/toggly-client-telemetry --all` | 0; one Core/reporter |
| Official public lock URL/integrity audit | 0; 873 entries, all seven `@ops-ai` packages checked live |
| `npm run typecheck` | 0 |
| `npm run lint` | 0 |
| `npm test -- --runInBand --detectOpenHandles` | 0; 2 suites, 10 tests |
| `npm run bundle:ios` | 0; production Metro bundle |
| `npm run bundle:android` | 0; production Metro bundle |
| `git diff --check` | 0 |

Raw logs, registry metadata, lock audit and bundle snapshots are retained in
`/private/tmp/ops1914-evidence`. The existing hosted workflow and App UI are
unchanged. This local record does not assert exact-head hosted CI success.

### Acceptance and negative controls

- Baseline clean public install passed the original 5 tests. Before changing
  the pins, the new automatic-metrics acceptance test failed against public
  Core 1.9.1 because it did not attach the native exception collector (1 failed,
  9 passed). The same unmodified test passes with Core 1.11.1/reporter 1.3.0.
- With `systemMetrics: true`, public Core forwards the original error and
  fatal flag to the previous ErrorUtils handler. Sampling windows accumulate
  three exceptions into one compact `m.ExceptionCount: 3` packet; the next
  flush contains only its new exception (`1`). Error messages and stacks
  are absent from packets.
- Default system metrics and explicit `enableTelemetry: false` leave the
  existing handler untouched and emit no automatic metric packets. A keyless
  opt-in client is transport-silent and restores its previous handler on
  disposal; its local counting handler may be installed while it is alive.
- Repeated disposal restores the previous handler and clears the client's
  timers. Later errors, elapsed timers and explicit counters cannot send
  post-disposal packets. A newer handler installed by the host survives
  client disposal.
- Existing compact feature payload, negate/short-circuit/entity behavior,
  identity/instance rotation, AppState flush, opt-out/keyless explicit events,
  and MMKV4-backed public provider render/unmount checks remain present.
  All network boundaries use mocked loopback collector URLs and sample keys.

### Limits and unchanged external findings

No new physical-device, simulator/emulator, stock Hermes execution, MMKV
persistence, or Nitro/JSI linkage run was performed for these refreshed pins.
Metro success is JavaScript bundling evidence only. A new native rebuild/run
remains separate acceptance work; the original native evidence above applies
only to its recorded versions. AppState remains covered with a synthetic
subscriber and ErrorUtils with a deterministic host handler double.

Both clean baseline and refreshed installs report the same npm audit summary:
54 vulnerabilities (5 moderate, 48 high, 1 critical) in the existing graph.
No audit remediation or host dependency upgrade is included in this fixture
refresh. Both Metro builds warn about React Native's private featureflags
export fallback and inherited NO_COLOR/FORCE_COLOR settings; bundles still
exit 0. No SDK source, package release version/changelog, shared analysis
workflow, or public-native hosted workflow changed.
