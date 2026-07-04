# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
