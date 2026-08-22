## 1.4.3

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
