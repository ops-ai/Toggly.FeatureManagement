## 1.6.0

2026-09-02

### Changed
- Local evaluation uses `@ops-ai/toggly-eval@2` SHA-256 sticky buckets
  (cohort shift vs FNV). Claims forwarded as EvalContext.claims [OPS-832].

## 1.5.2

2026-09-02

### Fixed
- Warm `init(undefined)` clears prior identity (identified→anonymous).
- `snapshotFlags({ identity })` returns a request-local evaluation; loaders
  and actions use it so concurrent requests do not share mutable flag state.
- Identity override objects treat `identity: undefined` as anonymous instead
  of falling back to the shared client identity.
- Concurrent cold-start `init` calls share one definitions fetch.

## 1.5.1

2026-09-02

### Fixed
- Re-init after warm start rebinds identity and re-snapshots flags from
  definitions (no stale first-user identity) [OPS-825 Oracle].
- Loader / action helpers pass request `IdentityContext` into each eval so
  concurrent requests do not share process-wide client identity.
- `evaluateGate` accepts optional `identityOverride`.

## 1.5.0

2026-09-02

### Changed
- Server client always uses `evaluationMode: 'local'`: fetch
  `definitions-signed` (no identity query) and evaluate with
  `@ops-ai/toggly-eval` at `isEnabled` / `evaluateGate` (OPS-825).
- Keep a boolean snapshot of local evaluation for hydration /
  `afterRefresh` compatibility.

## 1.4.4

2026-08-30

### Fixed
- After WebSocket `flags-updated`, do not cache the message etag before HTTP
  confirms the revision (avoids If-None-Match matching and a stale 304).
- Pin post-notify definitions GETs with `?rev=` and omit If-None-Match until
  the HTTP response updates the cached revision.

## 1.4.3

- Normalize public npm metadata for provenance and docs links (no API change).

2026-08-28

### Fixed

- Align `main` / `module` / `exports` with tsup output (`dist/index.js` and
  `dist/index.cjs`) so import and require resolve after install.

## 1.4.2

## 1.4.1

2026-08-28

### Fixed

- Publish `@ops-ai/remix-toggly-core` and shared packages as caret ranges
  instead of `file:` paths so the package installs from npm.

## 1.4.0

2026-08-21

### Added
- Entity context on `isEnabled` / `evaluateGate` with `registerContext`.
  Entity gates fail closed without context; hydrated flags keep gate objects.

### Changed
- README: loader/action `isEnabled` has no entity args; docs link to `/sdks/remix/server`.

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
