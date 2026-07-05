## 1.5.1

2026-07-05

### Added
- SDK identity on definitions traffic: `User-Agent` on server HTTP, `X-Toggly-Sdk` / `X-Toggly-Sdk-Version` on browser HTTP, `sdk` + `sdkVersion` query params on WebSocket connect.

# Changelog

## 1.5.0

2026-07-05

### Changed
- ETag-based WebSocket sync with definitions revision cache, conditional HTTP fetch, debounced refresh, and exponential reconnect backoff.
- Handles `sync`, `flags-updated`, and `signing-key-updated` WebSocket messages.

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
