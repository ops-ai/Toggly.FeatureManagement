# Changelog

## 1.6.0

2026-09-06

### Added
- Usage + business metrics gRPC telemetry (optional `@grpc/grpc-js` /
  `@grpc/proto-loader`) with batching, UA metadata, multi-variant wire fields,
  and flush on close [OPS-922].
- Nitro edge / Workers-like targets use gateway HTTPS JSON
  (`api/usage/stats`, `api/metrics`) when `telemetryTransport: 'https'` or
  `isEdgeRuntime()` is detected.
- Helpers: `recordServerUsage`, `recordServerView`, `measureServerMetric`,
  `incrementServerCounter`, `observeServerMetric`, `flushServerTelemetry`,
  `closeServerToggly`. Feature checks auto-record when usage tracking is on
  (default with `appKey`; disable via config or `TOGGLY_DISABLE_TELEMETRY=1`).

## 1.5.0

2026-09-04

### Added
- Ambient EvalContext for Nuxt/Nitro event helpers: `configureEventEvalContext`
  and `defineTogglyContextMiddleware` with `getIdentity` / `getGroups` /
  `getClaims` or `getContext`; request fields from H3 headers via
  `fromHttpRequest` [OPS-889].
- `useEventToggly` / `getEventToggly` / `isEventFeatureOn` bind full ambient
  context (identity, groups, claims, request) without per-call props;
  per-call `FeatureCheckOptions` still win field-by-field.
- `resolveEventEvalContext` caches ambient options on the H3 event
  (request-scoped only — no process-global identity mutation).

## 1.4.1

2026-09-03

### Fixed
- Drop unnecessary `headers` cast; `@ops-ai/toggly-eval` 2.0.3 accepts Fetch
  `Headers` in `fromHttpRequest` [OPS-874].

## 1.4.0

2026-09-03

### Added
- `isServerFeatureOn` / `Off` accept `{ identity, groups, claims, request,
  headers }` for full local EvalContext [OPS-874].
- `fromHttpRequest` re-export; `headers` map via `fromHttpRequest` with
  explicit `request` fields winning.

## 1.3.0

2026-09-02

### Changed
- Durable cache stores raw `FeatureDefinitionModel[]`; failed fetches hydrate
  via `hydrateDefinitions` (aligned with nextjs-toggly-server).
- Per-call `identity` on `isServerFeatureOn` / event helpers uses core
  `identityOverride` instead of mutating shared `client.identity`.
- `useEventToggly` binds request identity through a Proxy that forwards
  overrides without writing process-wide identity.
- Peer on `@ops-ai/nuxt-toggly-core` allows `^1.8.0`.

## 1.2.0

2026-09-02

### Changed
- `initServerToggly` forces `evaluationMode: 'local'` so the server fetches
  `definitions-signed` and evaluates with `@ops-ai/toggly-eval` (OPS-825).

## 1.1.1

2026-09-02

### Changed

- Pin `@ops-ai/nuxt-toggly-core` with `workspace:^` so publish resolves a compatible semver range instead of an exact snapshot that can strand sibling packages on two core copies.

## 1.1.0

2026-08-28

### Added
- WebSocket live updates enabled by default for long-lived Node servers via the
  `ws` package (`enableLiveUpdates: true`, `webSocketImpl` injected).
- Avoids per-request HTTP polling of definitions while keeping reconnect +
  debounced refresh on push.

### Changed
- Depends on `ws` for Node WebSocket when `globalThis.WebSocket` is absent.
- Peer/dependency on `@ops-ai/nuxt-toggly-core` allows `^1.6.0`.

## 1.0.3

- Normalize public npm metadata for provenance and docs links (no API change).

## 1.0.2

2026-07-14

### Changed
- **Breaking behavior:** `defineFeatureMiddleware` and `defineFeatureHandler` now fail closed with HTTP **503** when the server Toggly client is not initialized. Previously they allowed the request / ran the handler (fail open). Ensure `initServerToggly()` runs (e.g. Nitro plugin) before using gated routes, or gated endpoints will return 503.

### Fixed
- Misconfigured apps no longer silently bypass feature gates when the server client is missing.
