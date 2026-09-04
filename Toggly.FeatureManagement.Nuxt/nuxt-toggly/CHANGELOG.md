# Changelog

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
