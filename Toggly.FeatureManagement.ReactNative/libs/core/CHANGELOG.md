## 1.10.0 — 2026-09-24

### Added
- Typed `getVariantValue<T>(…, isT?)` with soft-null decode and optional runtime type guard.
- Exported `decodeVariantValue` helper for the same soft decode policy.

## 1.9.1 — 2026-09-23

### Fixed
- Require the Hermes-compatible telemetry reporter so native requests retain the configured collector path without an app-level URL polyfill.
- Construct complete definitions and JWKS URLs for React Native Hermes, preserving configured base paths and unrelated query values without requiring an app-level URL polyfill.

## 1.9.0 — 2026-09-22

### Added
- `enableVariants` configuration option: fetches `/evaluated-variants-signed` instead of `/evaluated-signed` and exposes `getVariant(featureKey)` / `getVariantValue(featureKey)` for reading the assigned variant name and configuration payload. Matches the `@ops-ai/feature-flags-toggly` (JS) and Vue SDK contract.
- Variant assignments persist in the offline cache alongside flags and are restored after a conditional (304) refresh, a failed refresh (last-known-good), or a cold app start.
- Feature checks (`isFeatureOn`, `isFeatureOff`, `evaluateFeatureGate`, `getVariant`) record the assigned variant name in telemetry instead of always recording `enabled`.

## 1.8.0 — 2026-09-21

### Added
- Optional host-minted `instanceId` on configuration and context updates; telemetry uses the token or current identity, and minted definitions requests suppress client targeting parameters.
- Default-on, bounded frontend telemetry for clients with an app key, with `enableTelemetry: false` opt-out and independent collector configuration.
- `recordUsage`, `recordView`, `incrementCounter`, `setGauge`, and `flushTelemetry`. Actual effective feature checks count once per evaluated leaf; usage and views remain explicit.

### Fixed
- Repair retired asynchronous cache writes and validate response body/validator pairs before cold conditional requests.
- Keep captured evaluations, cached bodies and validators, and pending refresh/identity callbacks scoped to their current owner; restore offline cached state and retire validators with replaced or evicted bodies.
- Keep disposed clients terminal across delayed storage, network, identity changes, timers, and live-update initialization.

## 1.7.4 — 2026-09-08

### Fixed
- Snapshot initial identity, groups, and claims before native lifecycle callbacks and asynchronous storage; coalesce refreshes during initialization into its first request.
- Bind persisted evaluated flags and revision validators to an unambiguous full context and endpoint scope, preventing cross-context startup cache reuse.
- Avoid starting refresh timers or live updates after disposal during initialization.

## 1.7.3

2026-08-30

### Fixed
- After WebSocket `flags-updated`, do not cache the message etag before HTTP
  confirms the revision (avoids If-None-Match matching and a stale 304).
- Pin post-notify definitions GETs with `?rev=` and omit If-None-Match until
  the HTTP response updates the cached revision.

## 1.7.2

- Normalize public npm metadata for provenance and docs links (no API change).

2026-08-28

### Fixed

- Publish shared packages as caret ranges instead of `file:` paths so the
  package installs from npm.

## 1.7.1

## 1.7.0

2026-08-21

### Added
- Entity context evaluation on `isFeatureOn` / `evaluateFeatureGate` with
  `registerContext`. Entity gates fail closed without context.

## 1.6.2

2026-07-14

### Added
- Optional `maxSignatureAgeSeconds` freshness check when `verifySignatures` is
  enabled (rejects stale signed envelopes; omit / <=0 keeps prior behavior).
- Uses shared `@ops-ai/toggly-signed-defs` for ES256 verification (single source of truth).

## 1.6.1

2026-07-14

### Fixed
- Type `getJwks()` as `JwkSet` so the core package builds under strict TypeScript
  (fixes CI `tsc` on develop).

## 1.6.0

2026-07-13

### Fixed
- Clear persisted JWKS on `signing-key-updated` and `clearCache` so retired keys
  cannot remain trusted after rotation (awaits storage delete before refresh).
- Reject empty `signature`/`kid` in signed envelopes.
- Harden signed-defs verification: top-level-only `defs` extraction, apply
  verified raw bytes (not `envelope.defs`), and accept DER→P1363 on WebCrypto.
- Signed definitions verification now uses exact raw `defs` JSON and Web Crypto
  **double SHA-256** (pre-hash then `subtle.verify` ECDSA SHA-256), matching
  Toggly.Definitions / Go / Node. Previously `JSON.stringify(flags)` + a single
  hash rejected every production signature when `verifySignatures` was enabled.

### Added
- `signedDefsVerify` helpers and regression tests (accept double-hash, reject
  single-hash / re-serialized defs / empty envelope fields).

# Changelog

## 1.5.0

2026-07-11

### Added
- `maxCacheKeys` opt-in LRU eviction for identity-scoped feature-flag cache entries (sidecar index at `@toggly:cache-lru`).

### Fixed
- `clearCache` now deletes the same full evaluation-context hash key used for feature-flag cache read/write.

## 1.4.0

2026-07-05

### Added
- `setContext({ identity, groups, claims })` and evaluation context on config for User Claims and group targeting.
- Context-aware cache keys for evaluated-signed responses.

## 1.3.1

2026-07-05

### Added
- SDK identity on definitions traffic: `User-Agent` on server HTTP, `X-Toggly-Sdk` / `X-Toggly-Sdk-Version` on browser HTTP, `sdk` + `sdkVersion` query params on WebSocket connect.

## 1.3.0

2026-07-05

### Changed

- WebSocket live updates use ETag-aware sync: definitions revision is cached, passed as `rev` on connect, and compared on `sync` / `flags-updated` / `signing-key-updated` messages before refreshing.
- HTTP fetches send `If-None-Match` and honor `304 Not Modified` via `X-Definitions-Revision` / `ETag` headers.
- WebSocket reconnect uses exponential backoff; refresh signals are debounced to avoid redundant fetches.

## 1.2.0

2026-07-03

### Added

- `onError` reports signed verification, refresh, and storage failures to React Native consumers.
- `effectiveFlagsChanged` event notifies providers, hooks, and components whenever effective flag state changes.

### Fixed

- Enforced signed-definition verification when signature validation is enabled.
- Preserved last-known-good flags on transient fetch, JWKS, signature, and storage failures.
- Failed closed for non-empty gates when no valid flags are available.

## 1.1.0

2026-06-28

### Added

- Device-local post-filter gates: `setLocalGates`, `notifyLocalGatesChanged`, and `localGatesChanged` event apply a read-time AND via `@ops-ai/toggly-local-gates`.
