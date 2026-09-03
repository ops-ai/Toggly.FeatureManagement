## 2.8.0

2026-09-03

### Added
- Optional `context` / `contextKind` (and `kind` alias) on `<feature>` for entity-gated flags,
  matching `*featureFlag` directive parity.

## 2.7.4

2026-08-30

### Fixed
- After WebSocket `flags-updated`, do not cache the message etag before HTTP
  confirms the revision (avoids If-None-Match matching and a stale 304).
- Pin post-notify definitions GETs with `?rev=` and omit If-None-Match until
  the HTTP response updates the cached revision.

## 2.7.3

- Normalize public npm metadata for provenance and docs links (no API change).

2026-08-28

### Fixed
- Publish installable semver ranges for `@ops-ai/toggly-hooks-types` and
  `@ops-ai/toggly-local-gates` instead of `file:` paths that leave unmet
  dependencies after `npm install`.

## 2.7.2

## 2.7.1

2026-08-21

### Changed
- Signed-definitions fetch now uses shared `@ops-ai/toggly-signed-defs`
  `InMemoryJwksCache`, `readAndParseEvaluatedResponse`, and
  `signedDefsClientOptions` instead of a per-SDK JWKS cache.
- Require `@ops-ai/toggly-signed-defs` `^1.2.0` so those shared helpers resolve.

## 2.7.0

2026-08-19

### Added
- Entity context evaluation for per-row/per-entity feature gates from cached
  `evaluated-signed` mixed `defs` (`true` / `false` / gate objects).
- `registerContext(kind, mapper)` on `TogglyService` to map domain entities to
  `TogglyEntityContext`.
- Optional `context` and `kind` on `isFeatureOn`, `evaluateFeatureGate`,
  `*featureFlag`, and `*featureGateBuilder` for local entity rule evaluation.
- Entity gates fail closed without context (gate objects are not treated as
  truthy booleans).

## 2.6.2

2026-07-14

### Added
- Optional `maxSignatureAgeSeconds` freshness check when `verifySignatures` is
  enabled (rejects stale signed envelopes; omit / <=0 keeps prior behavior).
- Optional `allowedKeyIds` allowlist passed through to signature verification.
- Uses shared `@ops-ai/toggly-signed-defs` for ES256 verification (single source of truth).

## 2.6.1

2026-07-14

### Fixed
- Keep signed-defs verification WebCrypto-only so Angular library/Karma builds
  do not pull Node `process`/`require`/`crypto` into the browser bundle.

## 2.6.0

2026-07-13

### Fixed
- Reject empty `signature`/`kid` in signed envelopes.
- Harden signed-defs verification: top-level-only `defs` extraction, apply
  verified raw bytes (not `envelope.defs`), and accept DER→P1363 on WebCrypto.
- Implemented `verifySignatures` for evaluated-signed responses: read raw body text, verify ES256 via Web Crypto double-hash over exact defs bytes, cache JWKS, and clear JWKS on `signing-key-updated`.

## 2.5.0

2026-07-11

### Added
- `maxCacheKeys` opt-in LRU eviction for identity-scoped flags/variants localStorage entries (sidecar index at `toggly:cache-lru`).
- `clearFeatureFlagsCache()` to remove the current context's flags/variants cache keys and update the LRU index.

## 2.4.0

2026-07-07

### Added
- `*featureGateBuilder` structural directive exposing `let enabled` for conditional UI while keeping content mounted.

### Fixed
- `<feature>` component now re-evaluates when device-local post-filter gates change via `notifyLocalGatesChanged()`.
- `*featureGateBuilder` re-evaluates when `featureGateBuilderRequirement` or `featureGateBuilderNegate` bindings change.
- `*featureFlag` re-evaluates when `featureFlagRequirement` or `featureFlagNegate` bindings change.

## 2.3.0

2026-07-05

### Added
- `setContext({ identity, groups, claims })` on `TogglyService`; passes groups and claims on evaluated-signed fetches.
- Context-aware cache keys for personalized evaluations.

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
