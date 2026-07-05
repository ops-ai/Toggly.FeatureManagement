# Changelog

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
