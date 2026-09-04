# Changelog


## 0.1.6

2026-09-02

### Added
- Default request context maps User-Agent / Accept-Language / CF-IPCountry
  via `fromHttpRequest` for segment filters [OPS-832].

## 0.1.5

2026-09-02

### Changed

- Pin `@ops-ai/toggly-node-core` with `workspace:^` so publish resolves a compatible semver range instead of an exact snapshot that can strand sibling packages on two core copies.

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
