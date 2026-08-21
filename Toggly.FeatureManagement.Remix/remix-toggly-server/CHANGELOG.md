## 1.3.2

2026-07-14

### Added
- Honors `verifySignatures` (plus optional `allowedKeyIds` / `maxSignatureAgeSeconds`) when fetching definitions via `@ops-ai/toggly-signed-defs`.

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

### Fixed

- Reported flag fetch failures through `onError` and preserved last-known-good server flags on transient failures.

## 1.1.0

2026-06-28

### Added

- `setLocalGates`, `notifyLocalGatesChanged`, and `subscribeLocalGatesChanged` on `TogglyServerClient` apply a read-time AND via `@ops-ai/toggly-local-gates`.
