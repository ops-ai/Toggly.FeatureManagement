## 1.12.0

2026-09-19

### Added
- Aggregate browser telemetry for effective feature checks and assigned variants, with explicit usage, view, counter, gauge and flush methods [OPS-1281].
- Per-service telemetry options, bounded background delivery and synchronous disposal. Telemetry defaults on with an application key; opt-out, keyless and server rendering remain silent. Payloads support optional minted instance or client identity attribution, excluding groups and claims [OPS-1281].

- Host-provided `instanceId` takes precedence in definitions and telemetry; context transitions retain original queued attribution. Client identity acceptance is server-controlled and off by default; HTTP202 does not prove acceptance [OPS-1314].

### Fixed
- Construct evaluated and variants endpoint paths correctly for configured base queries, suppress all client targeting for minted tokens, and never revive a configured token after context clearing.
- Keep cached response bodies paired with their mode-specific revisions, ignore ambiguous legacy bodies, and evict validators with their definitions. Active variants remain available when persistence is disabled or browser storage is unavailable.
- Isolate identity/token caches, response-mode revisions and pending responses, including return-to-token HTTP304. Failed context refresh still rejects its Promise while retaining the new context's scoped cache/defaults instead of restoring a previous user. Hooks reject superseded evaluation results [OPS-1314].
- Preserve provider ownership during StrictMode effect replay, dispose after the final unmount and create a fresh owner when remounted. Feature components follow service replacements and discard stale asynchronous results [OPS-1281].
- Forward entity context and default values through useFeatureFlag, and avoid duplicate variant checks from internal component projections [OPS-1281].

## 1.11.3

2026-09-11

### Changed
- Document host-owned React 18.2+ and React 19 setup in the published README.

### Fixed
- Resolve the signed-definitions verifier from the consuming runtime so browser builds use the browser-safe 1.2.7+ provider instead of bundling Node crypto.

## 1.11.2

2026-09-11

### Changed
- Externalize the React and JSX runtime imports so React hosts provide one
  runtime instance, and declare peer support for React and React DOM 18.2+
  and 19.x.

## 1.11.1

2026-09-04

### Fixed
- `setContext` withholds prior enables and restores identity/features when fetch
  fails [OPS-900].
- P2 error-envelope hardening via #370; bump `toggly-signed-defs` after merge
  [OPS-900].

## 1.11.0

2026-09-03

### Changed
- `<Feature fallback>` is deprecated. Prefer a separate `<Feature negate>` for the off path
  (aligned with .NET `<feature negate>`).

## 1.10.5

2026-08-30

### Fixed
- After WebSocket `flags-updated`, do not cache the message etag before HTTP
  confirms the revision (avoids If-None-Match matching and a stale 304).
- Pin post-notify definitions GETs with `?rev=` and omit If-None-Match until
  the HTTP response updates the cached revision.

## 1.10.4

- Normalize public npm metadata for provenance and docs links (no API change).

2026-08-28

### Fixed
- Publish installable semver ranges for `@ops-ai/toggly-hooks-types`,
  `@ops-ai/toggly-local-gates`, and `@ops-ai/toggly-signed-defs` instead of
  `file:` paths that leave unmet dependencies after `npm install`.

## 1.10.3

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
