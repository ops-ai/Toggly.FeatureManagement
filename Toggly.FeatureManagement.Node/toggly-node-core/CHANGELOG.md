## 0.4.1

## 0.5.0

2026-08-30

### Fixed
- After WebSocket `flags-updated`, do not cache the message etag before HTTP
  confirms the revision (avoids If-None-Match matching and a stale 304).
- Pin post-notify definitions GETs with `?rev=` and omit If-None-Match until
  the HTTP response updates the cached revision.


## 0.4.2

- Normalize public npm metadata for provenance and docs links (no API change).

2026-08-28

### Fixed

- Publish `@ops-ai/toggly-hooks-types` as `^1.4.3` instead of a `file:` path so
  the package installs from npm.

## 0.4.0

2026-08-21

### Added
- Read-time entity context on `isFeatureOn` / `evaluateFeatureGate`.
- `registerContext` maps domain objects and can PUT entity schemas at startup
  (`registerContextsOnStartup`). Entity gates fail closed without context.

## 0.3.2

2026-07-14

### Added
- Optional `maxSignatureAgeSeconds` freshness check when `verifySignatures` is
  enabled (rejects stale signed envelopes; omit / <=0 keeps prior behavior).

## 0.3.1

2026-07-13

### Fixed
- Always verify when `verifySignatures` is enabled (empty `signature`/`kid` no longer
  bypasses crypto and applies unsigned defs).
- `parseSignedEnvelope` rejects empty `signature` or `kid`.
- Clear durable JWKS cache on `signing-key-updated` (not only in-memory), so retired
  keys cannot rehydrate after rotation.
- `extractRawJsonProperty` only matches top-level keys (depth==1), so nested
  `data.defs` cannot be mistaken for the signed payload.
- After signature verify, the client applies flags from `parseDefinitionsFromRaw(defsRaw)`
  (verified bytes), never `envelope.defs` from the outer JSON parse.

### Added
- Regression test rejecting single-SHA256 signatures (double-hash contract).
- Public `parseDefinitionsFromRaw` helper for applying verified defs bytes.
- Client regression: empty signature with `verifySignatures` falls back to defaults.

# Changelog

## 0.3.0

2026-07-11

### Added
- ES256 signed envelope verification (`verifySignatures`) using exact raw `defs` JSON bytes + timestamp (double SHA-256), matching Go `crypto/verify.go`.
- Public `clearCache()` to clear in-memory features, ETag/revision, JWKS, and durable cache entries.
- Config `onError` callback; refresh failures always report errors while preserving last-known-good flags.
- Persists ETag/revision to cache and restores it on init; JWKS cache cleared on `signing-key-updated`.

### Changed
- Package version bumped to 0.3.0.

## 0.2.1

2026-07-05

### Added
- SDK identity on definitions traffic: `User-Agent` on server HTTP, `X-Toggly-Sdk` / `X-Toggly-Sdk-Version` on browser HTTP, `sdk` + `sdkVersion` query params on WebSocket connect.

## 0.2.0

2026-07-05

### Changed

- WebSocket sync uses in-memory ETag revision tracking with `?rev=` on connect, conditional HTTP fetches (`If-None-Match` / `X-Definitions-Revision`), 304 handling, debounced refresh (300ms), and exponential reconnect backoff.
- Handles `sync`, etag-aware `flags-updated`, and `signing-key-updated` WebSocket messages.

## 0.1.1

Initial published release.
