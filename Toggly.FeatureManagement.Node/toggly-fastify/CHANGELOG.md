# Changelog


## 0.1.4

2026-09-02

### Changed

- Pin `@ops-ai/toggly-node-core` with `workspace:^` so publish resolves a compatible semver range instead of an exact snapshot that can strand sibling packages on two core copies.

## 0.1.3

- Normalize public npm metadata for provenance and docs links (no API change).

## 0.1.2

2026-08-28

### Fixed

- Republish so npm resolves `@ops-ai/toggly-node-core` as a concrete version.
  Prior releases shipped an unresolved `workspace:*` dependency.

