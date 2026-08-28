# Changelog


## 1.1.1

- Normalize public npm metadata for provenance and docs links (no API change).

## 1.1.0

2026-07-03

### Fixed

- `useToggly` now reacts to core feature refresh notifications so timer and WebSocket updates reach Vue refs.
- `v-feature`, `v-feature-show`, and `v-feature-class` re-apply when refreshed flags arrive.
- Refresh failures preserve the current feature set and expose the core error state.
