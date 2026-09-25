# Changelog

## 2.1.0

2026-09-24

### Added
- Typed soft-bind overloads `getVariantValue(Class<T>, featureKey[, context])`
  and `getVariantValueOptional(...)` on `TogglyClient` / `Toggly`. Missing
  assignment or Jackson bind failure returns `null` / `Optional.empty()` —
  never throws solely for shape mismatch. Untyped `getVariantValue` unchanged.
  Jackson is used when on the classpath (test scope already includes it;
  add `jackson-databind` at runtime for POJO binding) [OPS-1365].

## 2.0.0

2026-09-23

### Breaking

- Removed the dual-rail evaluated-variants pipeline shipped in 1.7.0 entirely:
  `TogglyConfig.enableVariants` (and its builder setter), `EvaluatedVariantDef`,
  `VariantSnapshot`, and `SnapshotProvider.getVariantSnapshot()` /
  `getVariantSnapshotAsync()` / `refreshVariants()` no longer exist.
  `HttpSnapshotProvider` no longer fetches
  `evaluated-variants-signed/{appKey}/{environment}` at all.
- `VariantResult` gained a required third constructor argument, `enabled`
  (`VariantResult(String name, Object configurationValue, boolean enabled)`),
  reflecting the assigned variant's effective enabled state after any
  `StatusOverride`.

### Added

- **Catalog-local feature variants**, replacing the dual-rail model.
  `FeatureDefinition` now carries `variants` (`List<VariantDefinition>`) and
  `allocation` (`VariantAllocation`), parsed directly from the same
  `definitions` / `definitions-signed` payload that drives `isEnabled` — no
  separate network fetch, no `enableVariants` flag.
- `io.toggly.core.eval.VariantAllocator` — an MF-parity variant allocator
  matching `Microsoft.FeatureManagement`'s `IVariantFeatureManager`
  assignment pipeline bit-for-bit (user → group → percentile → default
  precedence, `StatusOverride` applied after assignment, percentile hashing
  via `SHA-256("{userId}\n{hint}")`). Verified against a gold corpus
  (`variant-allocator-corpus/cases.json`) generated from the real
  `Microsoft.FeatureManagement` 4.7.0 library — see
  `VariantAllocatorCorpusTest`.
- `TogglyClient.getVariant(featureKey)` / `getVariant(featureKey, context)` /
  `getVariantAsync(featureKey)` / `getVariantAsync(featureKey, context)` /
  `getVariantValue(featureKey)` / `getVariantValue(featureKey, context)` —
  same public method names as 1.7.0's dual-rail API, now backed entirely by
  catalog-local assignment. Mirrored on the `Toggly` static facade.
- `VariantDefinition`, `VariantAllocation` (with nested `UserAllocation` /
  `GroupAllocation` / `PercentileAllocation`), `VariantStatusOverride`,
  `VariantAssignment`, and `VariantAssignmentReason` model types.
- `io.toggly.core.util.SimpleJson` / `VariantJson` — shared, dependency-free
  JSON value parsing/serialization for variants and allocation rules, used by
  both `HttpSnapshotProvider` (wire parsing) and `RedisCachingSnapshotProvider`
  (cache round-trip), replacing a previously duplicated recursive-descent
  parser inside `HttpSnapshotProvider`.
- `toggly-cache-redis` now serializes/deserializes `variants` and `allocation`
  on its cached feature definitions, so variant assignment works correctly
  through the Redis caching layer.

### Migration from 1.x

Variants no longer require `TogglyConfig.enableVariants(true)` or a second
fetch — remove that config option, if set. `getVariant`/`getVariantValue`
call sites are source-compatible; only direct construction of `VariantResult`
(now requiring an `enabled` argument) or direct use of the removed
`EvaluatedVariantDef`/`VariantSnapshot` types needs updating.

## 1.7.0

2026-09-22

### Fixed
- `getVariantSnapshot()` no longer refetches on every call when the server
  returned an empty variants map. Track a separate `variantsLoaded` flag so
  "never fetched" and "fetched but empty" are distinct.

### Added
- `TogglyConfig.enableVariants` (default `false`). When enabled, `HttpSnapshotProvider`
  additionally fetches `evaluated-variants-signed/{appKey}/{environment}` on every
  refresh cycle (manual `refresh()`, scheduled poll, WebSocket notify) — dual-rail,
  matching the Python SDK: `definitions`/`definitions-signed` remain the source of
  truth for `isEnabled`; variants are a separate, additive cache that never
  replaces the definitions pipeline.
- `TogglyClient.getVariant(featureKey)` / `getVariantAsync(featureKey)` /
  `getVariantValue(featureKey)` — a new public variant-assignment API returning
  `VariantResult` (`name` + `configurationValue`), non-null only when
  `enableVariants` is true, the evaluated entry is `enabled == true`, and a
  non-empty variant name is present. Mirrored on the `Toggly` static facade.
  Distinct from the `variant` label already used by `recordUsage`/`recordView`
  telemetry, which is not an assignment API.
- `EvaluatedVariantDef` / `VariantResult` models and `VariantSnapshot` (new
  `io.toggly.core.snapshot` type, separate from `FeatureSnapshot`).
- `SnapshotProvider.getVariantSnapshot()` / `getVariantSnapshotAsync()` /
  `refreshVariants()` default methods (no-op unless overridden); implemented in
  `HttpSnapshotProvider` and `InMemorySnapshotProvider` (test helper
  `setVariants(...)`).
- Signed-variants verification reuses the existing ES256/JWKS pipeline, gated by
  the same `useSignedDefinitions` flag Java already exposes for definitions
  (Java has one signature toggle rather than JS's separate `verifySignatures`).
- `toggly-cache-caffeine` / `toggly-cache-redis` / `toggly-cache-redis-jedis8`
  now forward `getVariantSnapshot()` / `getVariantSnapshotAsync()` /
  `refreshVariants()` to their delegate, so `getVariant`/`getVariantValue` work
  correctly through caching wrappers instead of always seeing an empty variant
  snapshot.
- `HttpSnapshotProvider` now parses structured (object/array) `configurationValue`
  payloads for evaluated variants, not only scalars.

## 1.6.2

2026-09-17

### Fixed
- Default usage/metrics gRPC host is `https://metrics.toggly.io/`.

## 1.6.1

2026-09-17

### Changed
- Config, context-schema, feature-definition, and metrics payloads now copy
  collections on store and return so callers cannot mutate SDK internals
  (SpotBugs `EI_EXPOSE_REP` / `EI_EXPOSE_REP2`). Metrics observation
  grouping fills a local map, then constructs the immutable payload.
- SpotBugs skips generated protobuf clients; those findings are not
  actionable on `protoc` output.
- `@ConditionalOnFeature` no longer dereferences a null Spring
  `BeanFactory` when the client is not in the context yet.
- Spring Security role reflection catches only reflective and linkage
  failures, not every `Exception`.

## 1.6.0

2026-09-14

### Added
- `toggly-cache-redis-jedis8`, an opt-in Redis cache artifact for Jedis 8.0.1.
  It preserves the existing Redis key and snapshot serialization format while
  excluding the retained Jedis 5 dependency from Jedis 8 hosts.
- Packed Maven consumer fixtures for Servlet, Caffeine, retained Jedis 5.1.5,
  and Jedis 8.0.1, run on Java 17, 21, and 25.

### Changed
- `toggly-cache-redis` now uses the current Jedis 5.1.5 patch while retaining
  its public imports and constructors.
- Java 25 joins Java 17 and 21 in the SDK CI matrix. The Java 17 compiler
  target remains unchanged.

## 1.5.1

2026-09-10

### Changed
- Normalized published POM metadata for Maven Central (Toggly org,
  `support@toggly.io`, SCM → `ops-ai/Toggly.FeatureManagement`, issue
  management, docs URL).
- Wired Central Publisher Portal deploy (`central-publishing-maven-plugin`)
  and GPG signing in the `release` profile for `mvn -Prelease deploy`.
- Package version and `SdkIdentity.SDK_VERSION` aligned to `1.5.1`
  (`User-Agent` / UA: `toggly-java/1.5.1`).

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
- Redis feature map parsing only walks top-level keys so nested `"parameters": {}`
  objects are not treated as phantom features.
- WebSocket `flags-updated` / forced refresh no longer shares scheduled-poll
  skip suppression; notifies always HTTP-refresh so a new revision counts as a miss.
- WebSocket notifies that arrive during an in-flight refresh are queued and
  flushed once afterward (skipped attempt not counted).
- Redis `findMatchingBrace` ignores braces inside JSON string literals, matching
  `HttpSnapshotProvider`.

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
