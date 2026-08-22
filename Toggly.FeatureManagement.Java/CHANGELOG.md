# Changelog

## 1.2.0

2026-08-21

### Added
- ContextProperty entity filters (`contextKind` / `contextRequirementType`) with operators eq, neq, gt, gte, lt, lte, in, contains. Fail closed. User filters AND entity filters; percentage stays user-only.
- `TogglyEntityContext`, `registerContext`, and optional startup PUT `sdk/{appKey}/contexts` (opt-out via `registerContextsOnStartup`).

## 1.1.0

2026-07-11

### Added
- Real ES256 signed-definitions verification (double SHA-256 + ECDSA P-256, IEEE P1363 or DER), matching Go/worker.
- Persist raw `defs` JSON plus signature/kid/timestamp/etag on `FeatureSnapshot` for cache re-verification.
- `clear()` / `clearJwks()` on snapshot providers; `TogglyClient.clearCache()`.
- WebSocket `signing-key-updated` handling clears JWKS and forces refresh.
- `onError` callback and last-known-good behavior on transient refresh failures.
- Redis/Caffeine caches store and re-verify signed snapshot metadata.

### Fixed
- Signed definitions were accepted without cryptographic verification.
