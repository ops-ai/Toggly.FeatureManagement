## 0.5.1

2026-09-20

### Fixed
- Keep each automatic feature check attributed to the same context as its
  evaluated flags when entity callbacks or pending refreshes change identity.
- Stop captured checks after their client is disposed without changing the
  returned feature result.

## 0.5.0

2026-09-20

### Added
- Browser-only compact frontend telemetry for effective `getFlag` evaluations,
  explicit usage/views, counters, and gauges through `@ops-ai/toggly-client-telemetry` 1.1.0.
- `flushTelemetry()`, `setContext(...)`, and synchronous `dispose({ flush })`,
  including browser lifecycle, websocket, reconnect, and in-flight definition cleanup.
- Minted `instanceId` on definitions (`?i=`) and telemetry body `i`; client
  `identity` is sent as `u` only when `instanceId` is absent.
- A conditional browser entry plus an explicit `/browser` entry; portable
  server and edge imports remain telemetry-silent.

### Changed
- Added independent telemetry configuration and category opt-outs.
- Added packed CJS, ESM, strict declaration, and real-browser collector
  acceptance to the canonical JavaScript analysis and release gate.

## 0.4.0

2026-09-08

### Added
- Initial `groups` and string `claims` targeting options, copied before the first request and retained for refreshes.

### Fixed
- Serialize complete startup context with the shared encoded query builder, including repeated groups and the deterministic 20-claim limit.

# Changelog


## 0.3.1

2026-09-06

### Changed
- README: this package is a standalone client. The Docusaurus plugin and
  Cloudflare templates do not depend on it.

## 0.3.0

2026-09-06

### Fixed
- Fetch definitions from `/evaluated-signed/{appKey}/{environment}` via
  shared `buildEvaluatedSignedUrl`, matching Definitions and the other
  client SDKs. Identity still goes on `?u=`.

## 0.2.2

- Normalize public npm metadata for provenance and docs links (no API change).

## 0.2.1

2026-08-28

### Changed
- Confirm CI release via npm trusted publishing for
  `sdk-client-core-release.yml` (no functional API change).
- Set `repository.url` so provenance publish matches the GitHub source.

## 0.2.0

2026-08-21

### Added
- Entity context evaluation on `getFlag` with `registerContext`. Entity gates
  fail closed without context.

### Fixed
- Publish shared packages as caret ranges instead of `file:` paths so the
  package installs from npm.

## 0.1.6

2026-07-14

### Added
- `verifySignatures`, `allowedKeyIds`, and `maxSignatureAgeSeconds` on `TogglyConfig`.
- Signature verification via `@ops-ai/toggly-signed-defs` (JWKS at `/.well-known/jwks`) when `verifySignatures` is true.
