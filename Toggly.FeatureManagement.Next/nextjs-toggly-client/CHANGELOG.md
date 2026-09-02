# Changelog


## 1.1.2

2026-09-02

### Changed

- Pin `@ops-ai/nextjs-toggly-core` with `workspace:^` so publish resolves a compatible semver range instead of an exact snapshot that can strand sibling packages on two core copies.

## 1.1.1

- Normalize public npm metadata for provenance and docs links (no API change).

## 1.1.0

2026-07-03

### Fixed

- `TogglyProvider` now reacts to core feature refresh notifications so timer and WebSocket updates reach React state.
- Refresh failures preserve the current feature set and expose the core error state.
- `useFeatureFlag` and `useFeatureGate` stay in a loading state until the first post-init evaluation finishes, so callers do not read a stale `false` before `isFeatureOn` resolves.
