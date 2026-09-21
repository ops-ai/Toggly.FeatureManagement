# Changelog


## [1.1.0] - 2026-09-18

### Added
- Default browser telemetry with independent collector URL, configurable flush interval and explicit opt-out.
- Public usage, view, app-level counter, latest-value gauge and awaitable flush methods on the provider context.

### Fixed
- Count effective local/entity-gated browser checks once per evaluated leaf, preserving short circuit and negation without duplicate component evaluation.
- Isolate telemetry and hydrated snapshots when app/environment changes; release browser resources on real unmount while preserving StrictMode replay.
- Prevent delayed refresh/identity completion from updating a disposed provider.

### Changed
- Browser payloads omit user identity and targeting data; trusted server telemetry and loader/action behavior remain unchanged.

## 1.0.1

2026-09-17

### Fixed
- Default usage/metrics host is `https://metrics.toggly.io/`.

## 1.0.0

### Added

- Initial `@ops-ai/react-router-toggly` release for React Router 7/8 framework mode
- Folded Remix core/client/server into one package with `./client` and `./server` exports
- In-source core (eval, telemetry, types) — no dependency on `@ops-ai/remix-toggly-core`
- Peers: `react-router ^7 || ^8`, `react` / `react-dom ^18 || ^19`, optional `@react-router/node`
- Packed host coverage for RR7+React 18 and RR8+React 19.2.7+

### Migration

- `@ops-ai/remix-toggly-*` is deprecated. Use `@ops-ai/react-router-toggly` instead.
- Rename `RemixTogglyProvider` → `RouterTogglyProvider`
- Import from `@ops-ai/react-router-toggly/client` and `@ops-ai/react-router-toggly/server`
