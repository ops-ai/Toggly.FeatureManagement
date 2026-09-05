## 1.7.5

2026-09-05

### Fixed
- `setContext` / `clearContext` withhold prior flags and restore on failed refresh [OPS-901].

## 1.7.4

2026-08-30

### Fixed
- After WebSocket `flags-updated`, do not cache the message etag before HTTP
  confirms the revision (avoids If-None-Match matching and a stale 304).
- Pin post-notify definitions GETs with `?rev=` and omit If-None-Match until
  the HTTP response updates the cached revision.

## 1.7.3

- Normalize public npm metadata for provenance and docs links (no API change).

2026-08-28

### Fixed
- Point `main` / `module` / `exports` at `dist/feature-flags-toggly.bundle.js`
  so published packages resolve after install (previous `index.js` was not in
  the tarball).

## 1.7.2

## 1.7.1

2026-08-28

### Fixed
- Publish installable semver ranges for `@ops-ai/toggly-hooks-types`,
  `@ops-ai/toggly-local-gates`, and `@ops-ai/toggly-signed-defs` instead of
  `file:` paths that leave unmet dependencies after `npm install`.

## 1.7.0

2026-08-19

### Added
- Entity context evaluation from mixed `evaluated-signed` defs (`boolean | EntityGate`).
- `registerContext(kind, mapper)` and optional `context` / `kind` on `isFeatureOn` and
  `evaluateFeatureGate`.
- Entity gates fail closed when evaluated without context.

## 1.6.2

2026-07-14

### Added
- Optional `maxSignatureAgeSeconds` freshness check when `verifySignatures` is
  enabled (rejects stale signed envelopes; omit / <=0 keeps prior behavior).
- Optional `allowedKeyIds` allowlist passed through to signature verification.
- Uses shared `@ops-ai/toggly-signed-defs` for ES256 verification (single source of truth).

## 1.6.1

2026-07-14

### Fixed
- Configure webpack `resolve.fallback.crypto = false` so the browser bundle
  builds while signed-defs verify still uses Node `crypto` under Jest.

## 1.6.0

2026-07-13

### Fixed
- Reject empty `signature`/`kid` in signed envelopes.
- Harden signed-defs verification: top-level-only `defs` extraction, apply
  verified raw bytes (not `envelope.defs`), and accept DER→P1363 on WebCrypto.
- `verifySignatures` now verifies ES256 signed envelopes using exact raw `defs`
  JSON and Web Crypto double SHA-256 (was previously a no-op config flag).

## 1.5.0

2026-07-11

### Added
- `maxCacheKeys` opt-in LRU eviction for identity-scoped flags/variants localStorage entries (sidecar index at `toggly:cache-lru`).

## 1.4.0

2026-07-05

### Added
- `setContext({ identity, groups, claims })` and `clearContext()` for evaluated-signed targeting (User Claims, group rules).
- Evaluation cache keys include groups and claims so context changes trigger a refetch.

## 1.3.1

2026-07-05

### Added
- SDK identity on definitions traffic: `User-Agent` on server HTTP, `X-Toggly-Sdk` / `X-Toggly-Sdk-Version` on browser HTTP, `sdk` + `sdkVersion` query params on WebSocket connect.

## 1.3.0

2026-07-05

### Changed
- ETag-based WebSocket sync: connect sends `sync` with definitions revision; clients pass `?rev=` and skip HTTP fetch when unchanged.
- Unified definitions revision cache (`toggly:revision:{appKey}:{env}`) for HTTP `If-None-Match` and WebSocket sync.
- Debounced refresh (300ms) and exponential WebSocket reconnect backoff (5s–60s).
- Handles `signing-key-updated` by forcing JWKS and definitions refresh.

## 1.2.0

2026-07-03

### Added
- `onError` and `lastError` expose refresh, cache, and storage failures to consumers.

### Fixed
- Preserved last-known-good flags after transient refresh failures instead of falling back silently to defaults.
- Failed closed for non-empty gates when no valid flags are available.

## 1.1.0

2026-06-28

### Added
- Device-local post-filter gates (`localGates`, `setLocalGates`, `notifyLocalGatesChanged`, `subscribeLocalGatesChanged`) that AND worker booleans at read time
- Variant reads respect local gates on the `enabled` field
- Dependency on `@ops-ai/toggly-local-gates` for shared gate logic

## 1.0.5

2026-06-16

### Fixed
- URL-encode `identity` when appending the `u` query parameter on
  `/evaluated-signed` requests so targeting filters match on the edge worker.

## 0.0.1

2022-11-21 (Date of Last Commit)

* Toggly classe & models
* Allow usage without Toggly service (by providing flagDefaults)
* Allow usage with Toggly service (by providing your App Key & Environment name)
* Feature evaluation methods unit tests
* Documentation
* License

