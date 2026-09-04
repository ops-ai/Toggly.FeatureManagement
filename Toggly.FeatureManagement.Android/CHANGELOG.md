# Changelog

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
