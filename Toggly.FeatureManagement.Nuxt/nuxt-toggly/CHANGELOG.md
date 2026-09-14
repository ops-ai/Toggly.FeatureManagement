# Changelog

## 1.2.0 — 2026-09-12

### Added
- Support Nuxt 4 alongside Nuxt 3 with packed production-host verification.
- Provide request-isolated Vue SSR flags and evaluated-boolean hydration snapshots.

### Fixed
- Resolve runtime plugins from the built module directory and write the callback template for Nitro.
- Register server utilities in Nitro auto-imports and provide the symbol consumed by Vue composables.
- Close the server client during Nitro shutdown.
- Apply hydration through the core snapshot API so public core checks and Vue flags agree before network initialization.
- Keep hydration snapshots separate from fallback defaults when browser identity changes.

## 1.1.2 — 2026-09-08

### Fixed
- Forward and snapshot configured groups and claims before client and server initialization. The first client evaluation now includes the complete configured context without a second fetch.

## 1.1.1

2026-09-02

### Changed

- Pin sibling `@ops-ai/nuxt-toggly-*` packages with `workspace:^` so publish resolves compatible semver ranges instead of exact snapshots that can strand installs on two core copies.

## 1.1.0

2026-08-28

### Changed
- Client and server plugins forward `enableLiveUpdates` from module options.
- Server plugin no longer forces live updates off; defaults come from
  `@ops-ai/nuxt-toggly-server` (WebSocket live updates on, `refreshInterval: 0`).

## 1.0.2

- Normalize public npm metadata for provenance and docs links (no API change).

## 1.0.1

- Initial published package history tracked in this file.
