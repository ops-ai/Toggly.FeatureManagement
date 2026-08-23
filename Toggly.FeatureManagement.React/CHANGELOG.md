## 1.10.2

2026-08-23

### Changed
- Variant fetch-error fallback and defs-map coercion use shared
  `@ops-ai/toggly-signed-defs` helpers.

## 1.10.1

2026-08-21

### Changed
- Signed-definitions fetch now uses shared `@ops-ai/toggly-signed-defs`
  `InMemoryJwksCache`, `readAndParseEvaluatedResponse`, and
  `signedDefsClientOptions` instead of a per-SDK JWKS cache.

## 1.10.0

2026-08-19

### Added
- Entity context evaluation for mixed `evaluated-signed` definitions (`boolean |
  EntityGate`) via shared `@ops-ai/toggly-hooks-types` helpers.
- Optional `context` / `contextKind` on `isFeatureOn`, `evaluateFeatureGate`,
  `useFeatureGate`, and `<Feature>`.
- `registerContext(kind, mapper)` for domain-object → `TogglyEntityContext`
  mapping.
- Entity gates fail closed when no context is supplied.

## 1.9.1

2026-07-14

### Added
- Optional `maxSignatureAgeSeconds` freshness check when `verifySignatures` is
  enabled (rejects stale signed envelopes; omit / <=0 keeps prior behavior).
- Optional `allowedKeyIds` allowlist passed through to signature verification.
- Uses shared `@ops-ai/toggly-signed-defs` for ES256 verification (single source of truth).

## 1.9.0

2026-07-13

### Fixed
- Reject empty `signature`/`kid` in signed envelopes.
- Harden signed-defs verification: top-level-only `defs` extraction, apply
  verified raw bytes (not `envelope.defs`), and accept DER→P1363 on WebCrypto.
- Implemented `verifySignatures` for evaluated-signed responses: read raw body text, verify ES256 via Web Crypto double-hash over exact defs bytes, cache JWKS, and clear JWKS on `signing-key-updated`.

## 1.8.0

2026-07-11

### Added
- `maxCacheKeys` opt-in LRU eviction for identity-scoped flags/variants localStorage entries (sidecar index at `toggly:cache-lru`).
- `clearFeatureFlagsCache()` to remove the current context's flags/variants cache keys and update the LRU index.

## 1.7.0

2026-07-07

### Added
- `useFeatureFlag` and `useFeatureGate` hooks for conditional UI without show/hide wrappers.
- `<Feature render={(enabled) => ...} />` render prop for styling, taps, and behavior driven by the resolved gate boolean.

## 1.6.0

2026-07-05

### Added
- `setContext({ identity, groups, claims })` on the Toggly service; evaluated-signed URLs include groups and user claims query params.
- Context-aware cache keys so changing groups or claims invalidates cached evaluations.

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
