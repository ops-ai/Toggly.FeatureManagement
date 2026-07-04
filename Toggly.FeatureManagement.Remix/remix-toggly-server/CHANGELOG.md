# Changelog

## 1.2.0

2026-07-03

### Fixed

- Reported flag fetch failures through `onError` and preserved last-known-good server flags on transient failures.

## 1.1.0

2026-06-28

### Added

- `setLocalGates`, `notifyLocalGatesChanged`, and `subscribeLocalGatesChanged` on `TogglyServerClient` apply a read-time AND via `@ops-ai/toggly-local-gates`.
