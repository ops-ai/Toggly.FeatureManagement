## 1.9.3

2026-08-30

### Fixed
- After WebSocket `flags-updated`, do not cache the message etag before HTTP
  confirms the revision (avoids If-None-Match matching and a stale 304).
- Pin post-notify definitions GETs with `?rev=` and omit If-None-Match until
  the HTTP response updates the cached revision.

## 1.9.2

- Normalize public npm metadata for provenance and docs links (no API change).

2026-08-28

### Fixed
- Publish installable semver ranges for `@ops-ai/toggly-hooks-types`,
  `@ops-ai/toggly-local-gates`, and `@ops-ai/toggly-signed-defs` instead of
  `file:` paths that leave unmet dependencies after `npm install`.

## 1.9.1

## 1.9.0

2026-08-21

### Added
- Entity context evaluation for mixed `boolean | EntityGate` definitions.
- `registerContext(kind, mapper)` and optional context on `isFeatureOn` /
  `evaluateFeatureGate`. Entity gates fail closed without context.

## 1.8.4

2026-08-23

### Changed
- Variant fetch-error fallback and defs-map coercion use shared
  `@ops-ai/toggly-signed-defs` helpers.

## 1.8.3

2026-08-21

### Changed
- Signed-definitions fetch now uses shared `@ops-ai/toggly-signed-defs`
  `InMemoryJwksCache`, `readAndParseEvaluatedResponse`, and
  `signedDefsClientOptions` instead of a per-SDK JWKS cache.

## 1.8.1

2026-07-14

### Added
- Optional `maxSignatureAgeSeconds` freshness check when `verifySignatures` is
  enabled (rejects stale signed envelopes; omit / <=0 keeps prior behavior).
- Optional `allowedKeyIds` allowlist passed through to signature verification.
- Uses shared `@ops-ai/toggly-signed-defs` for ES256 verification (single source of truth).

## 1.8.0

2026-07-13

### Fixed
- Reject empty `signature`/`kid` in signed envelopes.
- Harden signed-defs verification: top-level-only `defs` extraction, apply
  verified raw bytes (not `envelope.defs`), and accept DER→P1363 on WebCrypto.
- Implemented `verifySignatures` for evaluated-signed responses: read raw body text, verify ES256 via Web Crypto double-hash over exact defs bytes, cache JWKS, and clear JWKS on `signing-key-updated`.

## 1.7.0

2026-07-11

### Added
- `maxCacheKeys` opt-in LRU eviction for identity-scoped flags/variants localStorage entries (sidecar index at `toggly:cache-lru`).
- `clearFeatureFlagsCache()` to remove the current context's flags/variants cache keys and update the LRU index.

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
