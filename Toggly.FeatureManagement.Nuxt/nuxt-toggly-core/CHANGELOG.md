## 1.9.0

2026-09-03

### Added
- Per-call `EvalContextOverrides` (`identity`, `groups`, `claims`, `request`)
  for local evaluation; string identity override remains supported [OPS-874].
- Re-export `fromHttpRequest` from `@ops-ai/toggly-eval` for header → request
  mapping.

## 1.8.1

2026-09-03

### Fixed
- Re-export `TogglyEntityContext`, `EvaluatedDefinitions`, `EntityGate`, and
  entity-context helpers from the package entry so `@ops-ai/nuxt-toggly-client`
  typecheck (and consumers) can import them [OPS-850].

## 1.8.0

2026-09-02

### Added
- Per-call `identityOverride` on `isFeatureOn` / `isFeatureOff` /
  `evaluateFeatureGate` so server packages can evaluate without mutating
  shared `client.identity` (OPS-825 Oracle).
- `getDefinitions()` and `hydrateDefinitions()` for durable definition-cache
  hydration on server packages.
- Re-export local-eval helpers (`snapshotEvaluatedBooleans`,
  `indexDefinitions`, `FeatureDefinitionModel`, …) for server wrappers.

### Changed
- Local evaluation uses `@ops-ai/toggly-eval@2` SHA-256 sticky buckets
  (cohort shift vs FNV). Config claims forwarded as EvalContext.claims
  [OPS-832].

## 1.7.0

2026-09-02

### Added
- `evaluationMode: 'local' | 'remote'` dual-rail (default `'remote'`) [OPS-825].
  Local mode fetches `definitions-signed` and evaluates with `@ops-ai/toggly-eval`
  at read time (identity / groups / claims / entity). Remote mode keeps the
  existing `evaluated-signed` + `appendEvaluationContext` behavior.
- Dependency on `@ops-ai/toggly-eval` for local definition evaluation.

### Changed
- In local mode, `setIdentity` updates identity only and does not force a
  refresh (identity is eval-time). Remote mode still refreshes after identify.

## 1.6.1

2026-08-30

### Fixed
- After WebSocket `flags-updated`, do not cache the message etag before HTTP
  confirms the revision (avoids If-None-Match matching and a stale 304).
- Pin post-notify definitions GETs with `?rev=` and omit If-None-Match until
  the HTTP response updates the cached revision.

2026-08-28

### Added
- Node/server WebSocket live updates via `webSocketImpl` or `globalThis.WebSocket`
  (no longer browser-only). Edge runtimes still skip long-lived sockets.
- `live-socket` helpers shared by browser WHATWG and `ws` EventEmitter APIs.

### Changed
- `DEFAULT_CONFIG.enableLiveUpdates` is `true` (was `false`); applies to browser
  and Node server clients. Callers can still pass `enableLiveUpdates: false`.

### Fixed
- Apply config defaults after spreading caller options so explicit `undefined`
  (e.g. from module plugins forwarding unset `enableLiveUpdates`) cannot wipe
  `DEFAULT_CONFIG` values.
- After a `flags-updated` / sync push, do not cache the WebSocket etag before
  the debounced HTTP refresh. Caching first caused `If-None-Match` to match the
  new revision, return 304, and leave in-memory flags stale.

## 1.6.0

## 1.5.2

## 1.5.1

- Avoid DOM globals in isBrowser so Node-only dependents typecheck
- Normalize public npm metadata for provenance and docs links (no API change).

2026-08-28

### Fixed

- Publish shared packages as caret ranges instead of `file:` paths so the
  package installs from npm.

## 1.5.0

2026-08-21

### Added
- Entity context evaluation for mixed definitions via `registerContext` and
  per-call context. Entity gates fail closed without context.

### Changed
- README links to `/sdks/nuxt/` (not `/sdks/javascript/nuxt`).

## 1.4.1

2026-07-14

### Added
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
