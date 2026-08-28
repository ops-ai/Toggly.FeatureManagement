## 1.7.1

2026-08-28

### Fixed

- Publish shared packages as caret ranges instead of `file:` paths so the
  package installs from npm.

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
