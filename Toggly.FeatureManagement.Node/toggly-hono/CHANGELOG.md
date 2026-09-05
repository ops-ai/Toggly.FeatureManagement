# Changelog

## 0.3.0

2026-09-04

### Added
- Optional `getGroups` / `getClaims` config and ambient EvalContext merge:
  providers bind identity/groups/claims per request; missing `request` is
  still filled from headers via `fromHttpRequest` even when `getContext`
  is used [OPS-887].

## 0.2.0

2026-09-03

### Added
- Set `EvalContext.request` via `fromHttpRequest` (UA / Accept-Language /
  country) while keeping UA in traits for BC [OPS-874].

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
