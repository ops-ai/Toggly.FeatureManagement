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
