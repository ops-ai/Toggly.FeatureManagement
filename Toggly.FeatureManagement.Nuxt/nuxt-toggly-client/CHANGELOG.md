## 1.3.0 — 2026-09-18

### Added
- Default-on compact browser telemetry for effective feature checks, plus `telemetry.recordUsage`, `recordView`, `incrementCounter`, `setGauge`, and `flushTelemetry`.
- Independent `enableTelemetry`, `enableUsageTracking`, `enableMetrics`, `metricsBaseUrl`, and `telemetryFlushIntervalMs` controls.

- Forward host-provided instance tokens with `i` precedence over `u`, preserve queued attribution across context changes, and capture evaluated state before callbacks.
- Keep browser context caches bounded and pair validators with the matching body and response mode; failed context refreshes never restore a retired user.
- Ignore unrelated SSR/legacy snapshots for minted contexts and tolerate unavailable browser storage.

### Changed
- Project readiness, flags and errors from accepted core state so skipped refreshes preserve initialization; direct disposal synchronously retires the facade.
- Replacing a browser client cancels and discards its retired telemetry owner; final disposal can flush.
- Mounted composables and components recompute effective local/entity gates and count actual checks after refreshed definitions, while cold hydration remains silent.
- Fence stale facade publications and pending UI results across refresh, context changes, replacement and disposal.
- Browser legacy `measure` and `observe` calls are payload-free no-ops with bounded diagnostics. Legacy usage/view keep identity as the second argument and use only the third argument as the variant.

## 1.2.2 — 2026-09-12

### Fixed
- Keep server-created Vue clients out of process-global client state.
- Render ready hydration snapshots synchronously without changing ordinary uninitialized gate loading behavior.

## 1.2.1

2026-09-04

### Fixed
- `setIdentity` publishes Vue identity and persists to localStorage only after
  the core client succeeds; failures restore prior identity and features
  [OPS-898].
- `refresh` syncs composable `features` from core state on failure [OPS-898].

## 1.2.0

2026-09-03

### Changed
- `<Feature>` no longer renders a `#fallback` slot for the off path. Use `negate`.
- `FeatureEnabled` / `FeatureDisabled` are deprecated; prefer `<Feature>` / `<Feature negate>`.

### Added
- Optional `context` / `contextKind` on `<Feature>` and gate composables for entity-gated flags.

# Changelog


## 1.1.2

2026-09-02

### Changed

- Pin `@ops-ai/nuxt-toggly-core` with `workspace:^` so publish resolves a compatible semver range instead of an exact snapshot that can strand sibling packages on two core copies.

## 1.1.1

- Fix EvaluatedDefinitions assignment typecheck in useToggly
- Normalize public npm metadata for provenance and docs links (no API change).

## 1.1.0

2026-07-03

### Fixed

- `useToggly` now reacts to core feature refresh notifications so timer and WebSocket updates reach Vue refs.
- `v-feature`, `v-feature-show`, and `v-feature-class` re-apply when refreshed flags arrive.
- Refresh failures preserve the current feature set and expose the core error state.
