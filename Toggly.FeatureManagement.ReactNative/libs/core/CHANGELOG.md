# Changelog

## 1.2.0

2026-07-03

### Added

- `onError` reports signed verification, refresh, and storage failures to React Native consumers.
- `effectiveFlagsChanged` event notifies providers, hooks, and components whenever effective flag state changes.

### Fixed

- Enforced signed-definition verification when signature validation is enabled.
- Preserved last-known-good flags on transient fetch, JWKS, signature, and storage failures.
- Failed closed for non-empty gates when no valid flags are available.

## 1.1.0

2026-06-28

### Added

- Device-local post-filter gates: `setLocalGates`, `notifyLocalGatesChanged`, and `localGatesChanged` event apply a read-time AND via `@ops-ai/toggly-local-gates`.
