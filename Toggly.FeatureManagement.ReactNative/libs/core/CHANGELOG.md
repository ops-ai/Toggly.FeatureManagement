## 1.3.1

2026-07-05

### Added
- SDK identity on definitions traffic: `User-Agent` on server HTTP, `X-Toggly-Sdk` / `X-Toggly-Sdk-Version` on browser HTTP, `sdk` + `sdkVersion` query params on WebSocket connect.

# Changelog

## 1.3.0

2026-07-05

### Changed

- WebSocket live updates use ETag-aware sync: definitions revision is cached, passed as `rev` on connect, and compared on `sync` / `flags-updated` / `signing-key-updated` messages before refreshing.
- HTTP fetches send `If-None-Match` and honor `304 Not Modified` via `X-Definitions-Revision` / `ETag` headers.
- WebSocket reconnect uses exponential backoff; refresh signals are debounced to avoid redundant fetches.

## 1.2.0

2026-07-03

### Added

- `onError` reports signed verification, refresh, and storage failures to React Native consumers.
- `effectiveFlagsChanged` event notifies providers, hooks, and components whenever effective flag state changes.

### Fixed

- Enforced signed-definition verification when signature validation is enabled.
- Preserved last-known-good flags on transient fetch, JWKS, signature, and storage failures.
- Failed closed for non-empty gates when no valid flags are available.

## 1.1.0

2026-06-28

### Added

- Device-local post-filter gates: `setLocalGates`, `notifyLocalGatesChanged`, and `localGatesChanged` event apply a read-time AND via `@ops-ai/toggly-local-gates`.
