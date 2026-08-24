# Changelog

## 0.3.0

2026-08-21

### Added
- ContextProperty entity filters (`context_kind` / `context_requirement_type`) with operators eq, neq, gt, gte, lt, lte, in, contains. Fail closed. User filters AND entity filters; percentage stays user-only.
- `TogglyEntityContext`, `register_context`, and optional startup PUT `sdk/{appKey}/contexts` (`register_contexts_on_startup`, default True).

## 0.2.1

2026-07-12

### Fixed
- Ruff lint: import sorting, unused import, nested `with` in `FileSnapshotProvider.clear_jwks`.

## 0.2.0

2026-07-11

### Added
- Real ES256 signed-definitions verification (double SHA-256 + ECDSA P-256, IEEE P1363 or DER).
- `signed_defs_json` on `DefinitionsSnapshot` for cache re-verification from raw bytes.
- `on_error` config callback and last-known-good behavior on transient failures.
- WebSocket `signing-key-updated` clears JWKS and forces refresh.
- `clear_jwks()` on snapshot providers; `clear_cache()` clears definitions + JWKS.

### Fixed
- `use_signed_definitions` previously fetched the signed endpoint without verifying signatures.
