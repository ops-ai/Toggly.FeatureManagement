# Changelog

## 1.4.0

2026-09-03

### Added
- `FeatureCheckOptions` accepts `groups`, `claims`, `request`, and `headers`
  for full local EvalContext (segment + UserClaims filters) [OPS-874].
- `headers` map via `fromHttpRequest`; explicit `request` fields win.
- Cache keys hash groups, claims, and resolved request alongside entity
  context. Identity-only keys keep the historical shape.
- `<Feature>` / `<FeatureVariant>` accept the same override props.

## 1.3.1

2026-09-03

### Fixed
- Coalesce concurrent `initServerToggly` calls onto one in-flight promise and
  swap the process-wide client before destroying the previous instance so
  Turbopack / parallel RSC no longer observe a null singleton mid-init.
  Additional callers while init is in flight join that promise (their config
  is ignored until the first init completes).
- `waitForServerToggly()` always awaits the in-flight init promise so
  `<Feature>`, actions, and cache helpers do not evaluate empty definitions
  after install-before-await.
- Destroy a failed replacement client after rolling back to the previous
  singleton so partial init cannot leak timers/sockets.

### Added
- `waitForServerToggly()` — resolves after the current init promise (or the
  ready singleton). Prefer this over `getServerToggly()` for evaluation.

## 1.3.0

2026-09-02

### Added
- `isServerFeatureOn`, `checkFeature`, `<Feature>`, cached helpers, and
  related APIs accept `{ context, contextKind }` for entity gates on the local
  evaluation rail. A string second argument remains user identity.
- Cache keys hash full entity attributes so two contexts that share kind/key
  cannot collide.

### Changed
- `<Feature negate>` renders children when the flag is off, matching .NET
  `<feature negate>`. `<FeatureOff>`, the `fallback` prop, and
  `<Feature.Fallback>` are removed.

### Changed
- `ServerFeatureOptions.context` is entity context (not an unused HTTP bag).
  `RequestContext` remains exported.

## 1.2.0

2026-09-02

### Changed
- Always initialize on the local evaluation rail (`evaluationMode: 'local'`) so
  the server package fetches `definitions-signed` and evaluates with
  `@ops-ai/toggly-eval` (OPS-825).
- Durable init cache stores raw `FeatureDefinitionModel[]` instead of evaluated
  booleans; failed fetches hydrate last-known-good definitions via
  `hydrateDefinitions`.
- `getServerFeatures` / `getFeatures` / `cachedGetFeatures` return an evaluated
  boolean snapshot from definitions (config identity / groups / claims).
- Per-call `identity` uses `identityOverride` on the shared client instead of
  mutating process-wide identity.

## 1.1.2

2026-09-02

### Changed

- Pin `@ops-ai/nextjs-toggly-core` with `workspace:^` so publish resolves a compatible semver range instead of an exact snapshot that can strand sibling packages on two core copies.

## 1.1.1

2026-08-28

### Fixed
- Pin the server client, config, and storage on `globalThis` so Next.js /
  Turbopack RSC and Route Handler bundles share one live client instead of
  separate module-level singletons.

## 1.1.0

2026-08-28

### Added
- WebSocket live updates enabled by default for long-lived Node servers via the
  `ws` package (`enableLiveUpdates: true`, `webSocketImpl` injected).
- Avoids per-request HTTP polling of definitions while keeping reconnect +
  debounced refresh on push.

### Changed
- Depends on `ws` for Node WebSocket when `globalThis.WebSocket` is absent.

## 1.0.2

- Normalize public npm metadata for provenance and docs links (no API change).

## 1.0.1

2026-08-28

### Fixed

- Republish so the npm package resolves `@ops-ai/nextjs-toggly-core` as a
  concrete semver range. `1.0.0` was published with an unresolved
  `workspace:*` dependency and is uninstallable.
