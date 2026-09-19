# Changelog

## 1.6.0

2026-09-18

### Added
- Anonymous frontend telemetry enabled for clients with an application key, with explicit opt-out and configurable metrics endpoint and flush interval.
- `recordUsage`, `recordView`, `incrementCounter`, `setGauge`, and suspend `flushTelemetry` on Core, the global facade, Compose hooks, and Views models.
- Automatic check counts for actual direct, Flow, Compose snapshot/entity, and Views evaluations, preserving short circuits and gate negation.

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
