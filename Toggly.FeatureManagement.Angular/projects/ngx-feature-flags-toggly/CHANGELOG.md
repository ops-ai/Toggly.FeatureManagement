## 2.2.1

2026-07-05

### Added
- SDK identity on definitions traffic: `User-Agent` on server HTTP, `X-Toggly-Sdk` / `X-Toggly-Sdk-Version` on browser HTTP, `sdk` + `sdkVersion` query params on WebSocket connect.

# Changelog

## 2.2.0

2026-07-05

### Added

- ETag-based definitions sync: HTTP requests send `If-None-Match`, honor `304 Not Modified`, and persist `X-Definitions-Revision`.
- WebSocket live updates use revision-aware sync (`sync`, `flags-updated`, `signing-key-updated`) with debounced refresh and exponential reconnect backoff.
- WebSocket remains enabled when `customDefinitionsUrl` is set (proxied HTTP only).

## 2.1.0

2026-07-03

### Added

- `onError` and `subscribeFeaturesRefresh` expose feature refresh failures and effective flag updates.

### Fixed

- Preserved loaded features on transient refresh failures instead of clearing UI state.
- `FeatureComponent`, `FeatureFlagDirective`, and `FeatureVariantDirective` re-evaluate when refreshed flags arrive.
- Failed closed for non-empty gates when no valid flags are available.

## 2.0.8

2026-06-28

### Added

- Device-local post-filter gates: `setLocalGates`, `notifyLocalGatesChanged`, and `subscribeLocalGatesChanged` apply a read-time AND on worker-evaluated booleans via `@ops-ai/toggly-local-gates`.
- `FeatureFlagDirective` subscribes to local gate changes and re-evaluates the view.
