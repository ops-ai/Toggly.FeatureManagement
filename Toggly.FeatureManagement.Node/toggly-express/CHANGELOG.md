# Changelog


## 0.1.4

- Normalize public npm metadata for provenance and docs links (no API change).

## 0.1.3

2026-08-28

### Fixed

- Republish so npm resolves `@ops-ai/toggly-node-core` as a concrete version.
  Prior releases shipped an unresolved `workspace:*` dependency.

## 0.1.2

2026-07-12

### Fixed
- `TogglyExpressConfig.onError` no longer conflicts with `TogglyServerConfig.onError` during DTS build (`Omit` + strip Express-only fields when creating the core client).
