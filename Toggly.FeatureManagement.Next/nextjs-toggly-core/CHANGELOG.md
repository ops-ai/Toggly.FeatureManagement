## 1.5.3

2026-08-30

### Fixed
- After WebSocket `flags-updated`, do not cache the message etag before HTTP
  confirms the revision (avoids If-None-Match matching and a stale 304).
- Pin post-notify definitions GETs with `?rev=` and omit If-None-Match until
  the HTTP response updates the cached revision.

2026-08-28

### Fixed
- After `flags-updated`, retry definitions HTTP fetch when the CDN still
  serves the previous revision (WS notify can race ahead of the edge cache).

## 1.5.2

## 1.5.1

2026-08-28

### Fixed
- After a `flags-updated` / sync push, do not cache the WebSocket etag before
  the debounced HTTP refresh. Caching first caused `If-None-Match` to match the
  new revision, return 304, and leave in-memory flags stale.
- Prefer the EventEmitter path when a socket exposes both `on()` and
  `onmessage` (as the `ws` package does).
- Closing a still-connecting `ws` socket keeps an error sink so destroy does
  not surface uncaught "closed before the connection was established" errors.
- Detach socket listeners on intentional `close()` and ignore stale handler
  callbacks after reconnect so an old `onClose` cannot orphan the new socket.

## 1.5.0

2026-08-28

### Added
- Node/server WebSocket live updates via `webSocketImpl` or `globalThis.WebSocket`
  (no longer browser-only). Edge runtimes still skip long-lived sockets.
- `live-socket` helpers shared by browser WHATWG and `ws` EventEmitter APIs.

### Changed
- `enableLiveUpdates` docs: applies to browser and Node server clients.

## 1.4.4

- Normalize public npm metadata for provenance and docs links (no API change).

2026-08-21

### Added
- README notes for per-eval entity context (clients do not PUT schemas).

### Changed
- README links to `/sdks/nextjs/` (not `/sdks/javascript/nextjs`).

## 1.4.2

2026-08-19

### Added
- Entity context evaluation for mixed `EvaluatedDefinitions` via `@ops-ai/toggly-hooks-types`.
- `registerContext(kind, mapper)` and optional `context`/`kind` on `isFeatureOn`, `isFeatureOff`, and `evaluateFeatureGate`.
- Fail-closed entity gate resolution when no entity context is supplied.

## 1.4.1

2026-07-14

### Added
- Consolidate evaluated-signed response helpers into `@ops-ai/toggly-signed-defs`.
- `verifySignatures`, `allowedKeyIds`, and `maxSignatureAgeSeconds` on `TogglyConfig`.
- Signature verification via `@ops-ai/toggly-signed-defs` (JWKS at `/.well-known/jwks`) when `verifySignatures` is true.

## 1.4.0

2026-07-05

### Added
- `groups` and `claims` options on `TogglyConfig` for server-side evaluated definitions.

### Changed
- Evaluated-signed fetch URLs use `@ops-ai/toggly-hooks-types@^1.3.0` (`appendEvaluationContext`).

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

- `onError` and `subscribeFeaturesRefresh` expose client refresh failures and effective flag updates.

### Fixed

- Preserved last-known-good flags on transient init and refresh failures instead of overwriting with defaults.
- Refresh failures now leave error state observable to consumers.

## 1.1.0

2026-06-28

### Added

- Device-local post-filter gates: `setLocalGates`, `notifyLocalGatesChanged`, and `subscribeLocalGatesChanged` apply a read-time AND on worker-evaluated booleans via `@ops-ai/toggly-local-gates`.
