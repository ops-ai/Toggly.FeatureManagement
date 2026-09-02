# Changelog

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
