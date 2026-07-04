# Changelog

## 1.2.0

2026-07-03

### Added

- `onError` and `subscribeFeaturesRefresh` expose client refresh failures and effective flag updates.

### Fixed

- Preserved last-known-good flags on transient init and refresh failures instead of overwriting with defaults.
- Refresh failures now leave error state observable to consumers.

## 1.1.0

2026-06-28

### Added

- Device-local post-filter gates: `setLocalGates`, `notifyLocalGatesChanged`, and `subscribeLocalGatesChanged` apply a read-time AND on worker-evaluated booleans via `@ops-ai/toggly-local-gates`.
