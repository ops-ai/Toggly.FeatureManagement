## 1.6.0

2026-07-07

### Added
- `FeatureGateBuilder` component with `let:enabled` slot for conditional styling and behavior.

### Fixed
- `<Feature>` now re-evaluates when device-local post-filter gates change via `notifyLocalGatesChanged()`.

## 1.5.0

2026-07-05

### Added
- `setContext({ identity?, groups?, claims? })` to update evaluation context at runtime and reload flags.
- `groups` and `claims` options on init for server-side evaluated definitions.

### Changed
- Evaluated-signed fetch URLs and localStorage cache keys use `@ops-ai/toggly-hooks-types@^1.3.0` (`appendEvaluationContext`, `evaluationContextCacheKey`).

## 1.4.1

2026-07-05

### Added
- SDK identity on definitions traffic: `User-Agent` on server HTTP, `X-Toggly-Sdk` / `X-Toggly-Sdk-Version` on browser HTTP, `sdk` + `sdkVersion` query params on WebSocket connect.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-07-05

### Changed

- WebSocket sync uses ETag-based revision tracking (`toggly:revision:{appKey}:{env}`) with `?rev=` on connect, conditional HTTP fetches (`If-None-Match` / `X-Definitions-Revision`), 304 handling, debounced refresh (300ms), and exponential reconnect backoff.
- Handles `sync`, etag-aware `flags-updated`, and `signing-key-updated` WebSocket messages.

## [1.3.0] - 2026-07-03

### Added

- `onError` reports feature refresh failures to Svelte SDK consumers.

### Fixed

- Preserved loaded features on transient refresh failures instead of clearing UI state.
- `<Feature>` re-evaluates when refreshed flags arrive through the flags store.
- Failed closed for non-empty gates when no valid flags are available.

## [1.2.0] - 2026-06-28

### Added

- Device-local post-filter gates: `setLocalGates`, `notifyLocalGatesChanged`, and `subscribeLocalGatesChanged` apply a read-time AND on worker-evaluated booleans via `@ops-ai/toggly-local-gates`.
- Store revision (`togglyLocalGatesRevision`) and `getEffectiveFlagValue` for reactive Svelte components.

## [1.0.0] - 2024-01-XX

### Added
- Initial release of Svelte feature flags SDK
- `createToggly()` function for initializing Toggly with configuration
- `<Feature>` Svelte component for conditional rendering based on feature flags
- Support for single and multiple feature keys
- Support for `all` and `any` requirement types
- Support for negated feature checks
- Reactive Svelte stores for feature flags
- Programmatic API: `isFeatureOn()`, `isFeatureOff()`, `evaluateFeatureGate()`
- `createFeatureStore()` for reactive feature flag stores
- Automatic flag refresh with configurable interval
- TypeScript support with full type definitions
- Works with or without Toggly.io (using feature defaults)
- Example application demonstrating all features
