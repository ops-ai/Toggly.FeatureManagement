# Changelog

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
