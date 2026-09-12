# Changelog

## 0.2.0 — 2026-09-12

### Added
- Node-only SolidStart server entrypoint with request-scoped evaluation and guards using the shared Node client.
- Explicit frontend signed snapshot allowlists, safe serialization, SSR initialization, and reactive navigation hydration.
- Packed SolidStart 2 host coverage for server/client boundaries and lifecycle.

### Fixed
- Bypass native HTTP caches while retaining explicit polling revision headers, so live invalidations cannot reuse stale browser validators.

## 0.1.0 — 2026-09-12

### Added
- Native Solid provider, signals, accessors, resource/Suspense and lazy declarative gates.
- Isolated targeting, verified signed definitions/cache, live updates, entity and device-local gates, and lifecycle disposal.

### Fixed
- Honor plain-text live invalidations and fetch unconditionally when update notifications omit a revision.
