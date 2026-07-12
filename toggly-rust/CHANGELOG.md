# Changelog

## 0.2.0

2026-07-11

### Added
- ES256 signed definitions verification using exact raw `defs` JSON bytes + timestamp (double SHA-256), matching Go `crypto/verify.go`.
- In-memory JWKS cache with refresh on `signing-key-updated` WebSocket messages.
- `clear_cache()` now clears evaluation cache, in-memory definitions, ETag/revision, and JWKS.
- `on_error` callback, `last_error()`, and last-known-good preservation on refresh/verify failure.
- Persist and use ETag / `X-Definitions-Revision` for conditional fetches and WebSocket `?rev=`.

### Changed
- Workspace package version bumped to 0.2.0.
