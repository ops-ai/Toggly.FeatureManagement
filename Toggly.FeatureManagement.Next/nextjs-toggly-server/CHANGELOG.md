# Changelog


## 1.0.2

- Normalize public npm metadata for provenance and docs links (no API change).

## 1.0.1

2026-08-28

### Fixed

- Republish so the npm package resolves `@ops-ai/nextjs-toggly-core` as a
  concrete semver range. `1.0.0` was published with an unresolved
  `workspace:*` dependency and is uninstallable.
