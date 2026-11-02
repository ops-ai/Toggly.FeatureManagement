# Changelog

## Unreleased

### Changed
- Toolchain: AGP 8.7.3 → 9.5.0 (built-in Kotlin), Gradle 8.14.5 → 9.6.0,
  Kotlin 2.0.21 → 2.4.21, KSP 2.0.21-1.0.28 → 2.3.13, compileSdk/targetSdk
  35 → 37 (minSdk 24 unchanged).
- Dependencies: Compose BOM 2024.12.01 → 2026.09.00, core-ktx 1.15.0 → 1.19.1,
  lifecycle 2.8.7 → 2.11.0, activity 1.9.3 → 1.13.0, Room 2.6.1 → 2.8.5,
  DataStore 1.1.1 → 1.3.0, coroutines 1.10.2 → 1.11.0, serialization 1.7.3 →
  1.12.0, mockk 1.13.17 → 1.14.11, OkHttp 4.12.0 → 4.12.1, Retrofit 2.11.0 →
  2.12.0 (majors unchanged).
- CI Java matrix 17/21 → 17/21/25; acceptance emulator API 35 → 36
  (compileSdk 37; API 37.0 AVDs do not boot on GHA macos-15-intel).

### Added
- Unit tests that drive public flag evaluation from mocked `evaluated-signed`
  / `evaluated-variants-signed` payloads, plus contract suites that load
  `docs/filter-parity/fixtures` and `variant-allocator-corpus/cases.json`.

## 1.9.1

2026-10-12

### Added
- Opt-in `systemMetrics` on `TogglyConfig` publishes `CpuUsage` and chained
  uncaught `ExceptionCount` gauges every 10 seconds when telemetry is enabled.
## 1.10.0

2026-10-11

### Added
- Feature usage scopes via `TogglyService.use` and telemetry compact-array slots
  for `errorCount`, `durationSumMs`, and `errorDurationSumMs` [OPS-1758].

### Fixed
- `TogglyService.use` no longer re-invokes `action` when a nullable success
  returns `null` (elvis fallback) [OPS-1758].
- Usage-scope durations use monotonic `elapsedRealtime` instead of wall-clock
  `currentTimeMillis`, so NTP / manual clock changes do not skew
  `durationSumMs` / `errorDurationSumMs` [OPS-1758].
- `TelemetryReporter.use` records the attempt and completion counters on the
  identity that started the scope when attribution changes while the action
  is suspended [OPS-1758].

## 1.9.0

2026-09-25

### Added
- Typed soft-null `getVariantValue<T>()` reified extension and
  `getVariantValue(featureKey, Class<T>)` on Core and the global facade.
  Missing assignment or decode failure returns `null` without throwing; the
  untyped `getVariantValue(featureKey): Any?` overload is unchanged.

## 1.8.0

2026-09-22

### Added
- `enableVariants` config option: when set, definitions are fetched from
  `evaluated-variants-signed` instead of `evaluated-signed` and each feature's
  signed variant assignment (name and optional configuration value) is
  parsed and cached alongside the existing boolean flags.
- `getVariant(featureKey)` and `getVariantValue(featureKey)` on Core and the
  global facade, plus a `currentVariants` snapshot, returning the assigned
  variant name and configuration value or `null` when the feature is
  disabled, unassigned, or variants are not enabled. Matches the Flutter and
  JS SDK contract.

## 1.7.1

2026-09-21

### Fixed
- Remove inherited `userId` and percent-encoded targeting parameter names from definitions requests while a minted `instanceId` is active. Preserve unrelated duplicate query values and existing requests without a token.

## 1.7.0

2026-09-19

### Added
- Forward host-minted `instanceId` to definitions as `i`, suppressing client identity, groups and claims while the token is set.
- Add `setIdentity(identity, instanceId)` and `setInstanceId(instanceId)` on Core, the global facade, Compose hooks/state and Views models. Blank or null tokens restore client targeting; the existing one-argument `setIdentity` clears any previous token.

### Fixed
- Preserve the original identity of buffered and retrying telemetry through login, logout and token rotation, using one globally bounded reporter queue.
- Include stored/generated device identities in telemetry after initialization without relabeling earlier anonymous events.
- Isolate definitions, validators, persisted cache scope and late cache responses across token changes; cache scope stores a hash rather than the minted capability.
- Keep delayed UI snapshots attributed to their original context and reset Compose state when identity changes even if flag values remain equal.

## 1.6.0

2026-09-18

### Added
- Anonymous frontend telemetry enabled for clients with an application key, with explicit opt-out and configurable metrics endpoint and flush interval.
- `recordUsage`, `recordView`, `incrementCounter`, `setGauge`, and suspend `flushTelemetry` on Core, the global facade, Compose hooks, and Views models.
- Automatic check counts for actual direct, Flow, Compose snapshot/entity, and Views evaluations, preserving short circuits and gate negation.
- Optional minted `instanceId` (`i`) and client `identity` (`u`) on compact telemetry envelopes. When both are set, only the instance id is sent.

### Changed
- Background transitions start a telemetry flush; reconfiguration disposes the old owner without relabeling buffered events.
- Telemetry uses private, bounded in-memory batches, native gzip, explicit rate-limit retries, and a bounded final flush on disposal. Targeting context and definition request headers are excluded.

### Fixed
- Compose provider replacement resets collected and remembered state to the new application/environment owner.
- Disposal permanently retires initialization, refresh, cache loading, and live-update work, including delayed completions during reconfiguration.

## 1.5.0

2026-09-12

### Added
- Add single-content `Feature` and `FeatureGate` overloads so enabled and
  disabled UI use separate blocks with opposite `negate` values.

### Deprecated
- Keep the earlier `fallback` overloads for source and binary compatibility.
  Migrate enabled and disabled content to separate `Feature` or `FeatureGate`
  blocks.

## 1.4.1

2026-09-11

### Changed
- Lockstep every Android module at 1.4.1. The `android-sdk-v1.3.0` publish
  shipped core as 1.4.0 and wrappers as 1.3.0, so GitHub notes advertised a
  core coordinate that was never produced.

## 1.4.0

2026-09-08

### Added
- Initial groups and string claims on `TogglyConfig`, copied before initialization so the first evaluated request includes all known targeting context.

### Fixed
- Encode repeated groups and claim query parameters safely, normalize empty values and cap claims at 20 sorted types.
- Bind evaluated caches and conditional requests to the full context, preventing another context from reusing an unchanged definitions revision. Legacy identity-only caches remain eligible only for empty groups and claims.

## 1.3.0

2026-09-02

### Changed
- Compose: `Feature` is the primary UI API with `negate` for the off path and
  optional `context` / `contextKind` for entity-aware evaluation. `FeatureGate`
  accepts the same entity parameters.
- Compose: `FeatureFlag` and `FeatureFlagOff` are deprecated in favor of
  `Feature` / `Feature(negate = true)`. `FeatureSwitch` remains as a
  Variant-style dual-slot helper, not the primary Off API.
- Views: docs and helpers prefer `bindToFeatureGate(..., negate = true)` for
  the off path; `showWhenFeatureDisabled` remains as a convenience wrapper.

## 1.2.0

2026-08-21

### Added
- Client-side entity-gate evaluation (eq, neq, gt, gte, lt, lte, in, contains)
  with fail-closed missing attributes, unknown operators, and empty rules.
- `registerContext` (local mapper only; no schema PUT) and
  `isFeatureEnabled(key, context)` / `evaluateFeatureGate(..., context)`.
- Mixed boolean + entity-gate definitions are stored internally; the public
  `FeatureFlags` map remains a derived snapshot (gates flatten to `false`
  without context).

### Fixed
- Signed and unsigned defs parsing no longer requires `Map<String, Boolean>`
  for every value, so entity-gate objects in `defs` do not fail kotlinx
  deserialization.

## 1.1.0

2026-07-14

### Added

- Persist signed-envelope metadata (`timestamp`, `signature`, `keyId`) with the
  exact raw defs JSON when `verifySignatures` succeeds, and re-verify on cold
  start before trusting cache (Flutter parity).
- Optional `maxSignatureAgeSeconds` on `TogglyConfig` to reject stale envelopes.
- Persist JWKS for offline cold-start re-verify; soft-fail (keep last-known-good)
  when JWKS/network is unavailable, fail closed on invalid signatures.

### Fixed

- When JWKS is available on cold-start re-verify, fail closed for all verification
  errors (unknown kid, key material issues), not only literal invalid-signature.

## 1.0.2

2026-07-14

### Fixed

- Decode signed-defs Base64 with a pure decoder so lint passes on minSdk 24
  (java.util.Base64 requires API 26) and JVM unit tests keep working.

## 1.0.1

2026-07-13

### Added

- Added opt-in verification of signed definitions using the production ES256,
  double-SHA-256, and raw JSON payload contract.

### Fixed

- Reject empty `signature`/`kid` in signed envelopes.
- Refresh definitions on `signing-key-updated` WebSocket messages.
- Harden verification: top-level-only `defs` extraction and apply verified raw
  defs bytes (never re-parsed outer envelope fields after verify).
