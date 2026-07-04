# Changelog

## 1.1.0

2026-07-03

### Added

- `onError` reports edge definition fetch failures to consumers.

### Fixed

- Preserved last-known-good edge flags on transient fetch failures instead of overwriting initialized state with defaults.
