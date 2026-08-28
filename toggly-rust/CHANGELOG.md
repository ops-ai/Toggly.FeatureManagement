# Changelog

## 0.3.1

2026-08-28

### Changed
- Public crates.io metadata: author `Toggly <support@toggly.io>`, repository URL to `ops-ai/Toggly.FeatureManagement`.
- Release workflow uses crates.io Trusted Publishing (OIDC) via `rust-lang/crates-io-auth-action`, with `CARGO_REGISTRY_TOKEN` fallback until Trusted Publishers are configured on each crate.

## 0.3.0

2026-08-21

### Added
- ContextProperty entity filters (`context_kind` / `context_requirement_type`) with operators eq, neq, gt, gte, lt, lte, in, contains. Fail closed. User filters AND entity filters; percentage stays user-only.
- `TogglyEntityContext`, schema registration, and optional startup PUT `sdk/{appKey}/contexts` (`disable_entity_context_registration` to opt out).

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
