## 1.9.1

2026-08-21

### Changed
- Signed-definitions fetch now uses shared `@ops-ai/toggly-signed-defs`
  `InMemoryJwksCache`, `readAndParseEvaluatedResponse`, and
  `signedDefsClientOptions` instead of a per-SDK JWKS cache.

## 1.9.0

2026-08-19

### Added
- Entity context evaluation for mixed `evaluated-signed` definitions (`boolean |
  EntityGate`) via shared `@ops-ai/toggly-hooks-types` helpers.
- Optional `context` / `contextKind` on `isFeatureOn`, `evaluateFeatureGate`,
  `getEffectiveFlagValue`, `useFeatureGate`, and `<Feature>`.
- `registerContext(kind, mapper)` for domain-object → `TogglyEntityContext`
  mapping.
- Entity gates fail closed when no context is supplied.

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

## 1.6.1

2026-07-07

### Changed
- `useFeatureGate` now accepts a single options object (`{ featureKey?, featureKeys?, requirement?, negate?, toggly? }`) or a `computed()` when options depend on reactive props, instead of positional arguments.

### Fixed
- `<Feature>` no longer wraps slotted content in an extra `<div>` when visible.

## 1.6.0

2026-07-07

### Added
- `FeatureGateBuilder` component with scoped slot `{ enabled }` for conditional styling and behavior.
- `useFeatureFlag` and `useFeatureGate` composables mirroring the builder evaluation path.

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
