# Changelog


## 1.1.2

2026-09-02

### Changed

- Pin `@ops-ai/nuxt-toggly-core` with `workspace:^` so publish resolves a compatible semver range instead of an exact snapshot that can strand sibling packages on two core copies.

## 1.1.1

- Fix EvaluatedDefinitions assignment typecheck in useToggly
- Normalize public npm metadata for provenance and docs links (no API change).

## 1.1.0

2026-07-03

### Fixed

- `useToggly` now reacts to core feature refresh notifications so timer and WebSocket updates reach Vue refs.
- `v-feature`, `v-feature-show`, and `v-feature-class` re-apply when refreshed flags arrive.
- Refresh failures preserve the current feature set and expose the core error state.
