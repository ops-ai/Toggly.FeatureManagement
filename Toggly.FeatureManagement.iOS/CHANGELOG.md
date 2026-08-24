# Changelog

All notable changes to the Toggly iOS SDK are documented in this file.

## 1.2.0

2026-08-21

### Added
- Client-side entity-gate evaluation (eq, neq, gt, gte, lt, lte, in, contains)
  with fail-closed missing attributes, unknown operators, and empty rules.
- `registerContext` (local mapper only; no schema PUT) and
  `isEnabled(_:context:)` / `evaluateFeatureGate(..., context:)`.
- Mixed boolean + entity-gate definitions are stored internally; the public
  `FeatureFlags` map remains a derived snapshot (gates flatten to `false`
  without context).

### Fixed
- `parseDefinitions` no longer throws `invalidEnvelope` when `defs` contains
  entity-gate objects instead of booleans.

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
  errors (unknown kid, key material issues), not only `invalidSignature`.

## 1.0.1

2026-07-13

### Added
- Production-compatible signed definitions verification (`verifySignatures`) using
  exact raw `defs` JSON bytes, double SHA-256 digests, and ES256 P-256 (Security
  framework digest-level verify). JWKS are fetched from `{baseURI}/.well-known/jwks`.
  When `verifySignatures` is false (default), parsing behavior is unchanged.

### Fixed
- Clear in-memory JWKS on `signing-key-updated` WebSocket messages so retired
  keys are not reused after rotation.
- Reject empty `signature`/`kid` in signed envelopes.
- Signed responses are no longer accepted without cryptographic verification when
  `verifySignatures` is enabled; invalid signatures fall back to cache/defaults and
  populate `lastError`, matching Go / Node / Flutter SDK behavior.
- Harden verification: top-level-only `defs` extraction and apply verified raw
  defs bytes after signature check.
