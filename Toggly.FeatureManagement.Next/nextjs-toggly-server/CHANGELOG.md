# Changelog

## 1.3.0

2026-09-02

### Added
- `isServerFeatureOn`, `checkFeature`, `<Feature>`, cached helpers, and
  related APIs accept `{ context, contextKind }` for entity gates on the local
  evaluation rail. A string second argument remains user identity.
- Cache keys hash full entity attributes so two contexts that share kind/key
  cannot collide.
- `<Feature.Fallback>` / `<FeatureOff.Fallback>` nested children, in addition
  to the `fallback` prop.

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
