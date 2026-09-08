# Changelog

## 1.5.0

2026-09-07

### Added
- Definition-refresh cache hit/miss counters on `Usage.SendStats`
  (`definitionCacheHits` / `definitionCacheMisses`) from `HttpSnapshotProvider`.
- Full usage-batch restore (feature stats + hashes + cache counters) when
  `sendStats` fails, including close-safe batcher capture across in-flight send.

### Fixed
- Unsigned Redis durable loads now route through `applyCachedSnapshot` so
  startup-from-cache records a definition-cache hit (same as the signed path).
- Redis snapshot deserialization uses balanced-brace object extraction so nested
  feature filters round-trip correctly from the durable cache.

### Changed
- Package version and `SdkIdentity.SDK_VERSION` aligned to `1.5.0`
  (`User-Agent` / UA: `toggly-java/1.5.0`).

## 1.4.0

2026-09-06

### Added
- Usage (`Usage.SendStats`) and business metrics (`Metrics.SendMetrics`) gRPC
  telemetry in `toggly-core` with ~1 minute batching and flush on `close()`.
- Public APIs: `recordUsage` / `recordView`, `measure` / `incrementCounter` /
  `observe`, plus auto `recordCheck` from `isEnabled` when usage tracking is on.
- Config: `enableMetrics`, `metricsBaseUrl`, flush intervals, `instanceName`,
  `appVersion`. Spring Boot properties mirror the same knobs.
- UTF-8 FNV-1a identity hashing and multi-variant `variantStats` /
  `variantValues` payloads matching Go/Node/.NET.

### Changed
- `toggly-core` keeps flag evaluation free of required runtime deps; gRPC +
  protobuf are optional Maven dependencies for sending telemetry.
- `SdkIdentity` version aligned to `1.4.0`.

## 1.3.0

2026-09-04

### Added
- Server-side filter parity with `@ops-ai/toggly-eval` / Definitions: segment filters
  (`BrowserFamily`, `BrowserLanguage`, `Country`/`CountryFamily`, `DeviceType`,
  `OS`/`OperatingSystem`), `UserClaims`, and `AlwaysOff`.
- `EvaluationContext` claims + `RequestContext` (userAgent, acceptLanguage, country)
  and `HttpRequestMapper.fromHttpHeaders` for CF/Vercel/CloudFront country headers.
- Microsoft.* aliases for Percentage, TimeWindow, and Targeting.
- Golden fixture tests loading `docs/filter-parity/fixtures/`.

### Changed
- Percentage / segment sticky buckets now use Definitions SHA-256
  (`featureKey\nuserId`) instead of FNV-1a (cohort shift for identified rollouts).

## 1.2.0

2026-08-21

### Added
- ContextProperty entity filters (`contextKind` / `contextRequirementType`) with operators eq, neq, gt, gte, lt, lte, in, contains. Fail closed. User filters AND entity filters; percentage stays user-only.
- `TogglyEntityContext`, `registerContext`, and optional startup PUT `sdk/{appKey}/contexts` (opt-out via `registerContextsOnStartup`).

## 1.1.0

2026-07-11

### Added
- Real ES256 signed-definitions verification (double SHA-256 + ECDSA P-256, IEEE P1363 or DER), matching Go/worker.
- Persist raw `defs` JSON plus signature/kid/timestamp/etag on `FeatureSnapshot` for cache re-verification.
- `clear()` / `clearJwks()` on snapshot providers; `TogglyClient.clearCache()`.
- WebSocket `signing-key-updated` handling clears JWKS and forces refresh.
- `onError` callback and last-known-good behavior on transient refresh failures.
- Redis/Caffeine caches store and re-verify signed snapshot metadata.

### Fixed
- Signed definitions were accepted without cryptographic verification.
