# Changelog

## 1.4.0

2026-07-03

### Added

- `onError` reports feature refresh failures to React SDK consumers.

### Fixed

- Preserved loaded features on transient refresh failures instead of briefly clearing UI state.
- Failed closed for non-empty gates when no valid flags are available.

## 1.3.0

2026-06-28

### Added

- Device-local post-filter gates: `setLocalGates`, `notifyLocalGatesChanged`, and `subscribeLocalGatesChanged` apply a read-time AND on worker-evaluated booleans via `@ops-ai/toggly-local-gates`.
- `Feature` and `useVariant` subscribe to local gate changes for instant UI updates.
