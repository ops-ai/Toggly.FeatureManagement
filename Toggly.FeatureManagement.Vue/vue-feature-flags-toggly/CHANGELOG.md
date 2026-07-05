## 1.4.1

2026-07-05

### Added
- SDK identity on definitions traffic: `User-Agent` on server HTTP, `X-Toggly-Sdk` / `X-Toggly-Sdk-Version` on browser HTTP, `sdk` + `sdkVersion` query params on WebSocket connect.

# Changelog

## 1.4.0

2026-07-05

### Changed

- WebSocket sync uses ETag-based revision tracking (`toggly:revision:{appKey}:{env}`) with `?rev=` on connect, conditional HTTP fetches (`If-None-Match` / `X-Definitions-Revision`), 304 handling, debounced refresh (300ms), and exponential reconnect backoff.
- Handles `sync`, etag-aware `flags-updated`, and `signing-key-updated` WebSocket messages.

## 1.3.0

2026-07-03

### Added

- `onError` reports feature refresh failures to Vue SDK consumers.

### Fixed

- Preserved loaded features on transient refresh failures instead of clearing UI state.
- `Feature` components re-evaluate when refreshed flags arrive.
- Failed closed for non-empty gates when no valid flags are available.

## 1.2.0

2026-06-28

### Added

- Device-local post-filter gates: `setLocalGates`, `notifyLocalGatesChanged`, and `subscribeLocalGatesChanged` apply a read-time AND on worker-evaluated booleans via `@ops-ai/toggly-local-gates`.
- `Feature` component and `useVariant` subscribe to local gate changes.
