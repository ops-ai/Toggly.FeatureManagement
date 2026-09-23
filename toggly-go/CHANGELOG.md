# Changelog

## 0.9.0

2026-09-23

### Breaking
- Removed the server-side `evaluated-variants-signed` dual-rail entirely:
  `Config.EnableVariants`, `Config.VariantIdentity`, `Config.VariantGroups`,
  `Config.VariantClaims`, and `Client.SetVariantIdentity` are gone. Variant
  assignment is now computed locally from the cached definitions catalog —
  no extra network round-trip, no server-side identity coupling [OPS-1395].
- `Client.GetVariant` and `Client.GetVariantValue` now take `(ctx
  context.Context, featureKey string, evalCtx Context)` instead of
  `(featureKey string)`, matching `IsEnabled`'s signature and ambient
  evaluation-context resolution. `GetVariant` returns `(*VariantResult,
  error)`; `VariantResult` gains an `Enabled` field.

### Added
- Catalog-local variant allocation ported bit-for-bit from
  Microsoft.FeatureManagement 4.7.0's `FeatureManager.GetVariantAsync`:
  disabled features resolve `DefaultWhenDisabled` only; enabled features
  check User → Group → Percentile → `DefaultWhenEnabled` in order. Percentile
  buckets hash `{userId}\n{seed-or-"allocation\n{featureKey}"}` with
  SHA-256, matching Microsoft.FeatureManagement's sticky-bucket scheme.
- `Variants` / `Allocation` fields on the definitions wire model
  (`FeatureDefinitionModel`), decoded from `/definitions` and
  `/definitions-signed` like any other feature field — no separate endpoint.
- `Config.VariantIgnoreCase` mirrors Microsoft.FeatureManagement's
  `TargetingEvaluationOptions.IgnoreCase` for variant user/group targeting
  (default `false`, case-sensitive).
- Verified against the shared `variant-allocator-corpus` gold corpus (18
  cases) for bit-for-bit parity with the Microsoft.FeatureManagement 4.7.0
  allocator.

### Changed
- User-Agent is `toggly-go/0.9.0`.

## 0.8.1

2026-09-17

### Fixed
- Usage and metrics gRPC dial `https://metrics.toggly.io/` by default via
  `Config.MetricsURL`. Product API / context registration stay on `BaseURL`.

### Changed
- `go-sqlite3` 1.14.52 and MongoDB Go Driver v1 1.17.10 (CVE-2026-88031).
  grpc stays at 1.80.0 so Dependabot cannot raise the Go 1.24 floor on
  `toggly-go-mongodb-v2` [OPS-1263].
- User-Agent is `toggly-go/0.8.1`.

## 0.8.0

2026-09-17

### Changed
- Requires Go 1.25. Applications can compile with current
  `golang.org/x/crypto` and `golang.org/x/net`, including `x/crypto` 0.52
  and `x/net` 0.55 or later. 0.7.0 failed to compile on Go 1.27 when
  `x/crypto` 0.52 selected `x/net` 0.54.
- User-Agent is `toggly-go/0.8.0`.

## 0.7.0

2026-09-08

### Added
- `VariantGroups` and `VariantClaims` seed the first remotely evaluated variants request with copied startup targeting context [OPS-1102].

### Fixed
- Bind variant snapshots and validators to the complete request context; reject legacy unscoped variant snapshots.
- Clear cached variant payloads and timestamps when identity changes, and discard responses started before that change.
- Keep evaluated snapshots out of ordinary local-definition caches.

### Changed
- User-Agent is `toggly-go/0.7.0`.

## 0.6.0

2026-09-08

### Added
- Definition-refresh cache hits and misses (`definitionCacheHits` /
  `definitionCacheMisses`) on `Usage.SendStats` [OPS-989].
- In-flight refresh guard; concurrent skip does not count. Scheduled poll
  skip (live WS) counts as a hit; WebSocket-forced refresh is not suppressed
  by poll skip and counts a miss when a new revision applies.

### Changed
- Usage batcher restores the full batch (feature stats, hashes, cache
  counters) on `SendStats` failure, merging with in-flight records.
- Cache-only usage batches still flush when only cache counters are pending.
- User-Agent is `toggly-go/0.6.0`.

## 0.5.0

2026-09-05

### Added
- Usage `RecordView` / unique viewed hashes and multi-variant `variantStats`
  on `SendStats` (aligned with .NET) [OPS-916].
- Business metrics `variantValues` aggregation for Measure / Increment /
  Observe [OPS-916].
- gRPC `UA` metadata on usage/metrics sends; best-effort flush on `Close`
  [OPS-916].
- Ambient EvalContext DX: `togglyhttp.FromHttpRequest` maps UA /
  Accept-Language / country headers (`cf-ipcountry`, `x-vercel-ip-country`,
  `cloudfront-viewer-country`) [OPS-934].
- `togglyhttp.MiddlewareWith` / `Options` with optional `GetIdentity`,
  `GetGroups`, `GetClaims`, `GetContext`; request headers always enrich
  missing `Request` fields.
- `Client.IsEnabled` merges request-scoped ambient context
  (`toggly.WithEvalContext` / `togglyctx.With`) with per-call Context —
  non-empty / non-nil per-call fields win field-by-field.
- `toggly.MergeContext` / `ResolveEvalContext` and `togglyctx.Merge` /
  `Resolve` helpers.
- `FromHttpRequest` merges `extras.Request` field-by-field with headers
  (non-empty extras win), matching Middleware / BuildContext.

### Changed
- Usage and metrics protos match .NET field shapes (`variantStats`,
  `viewedCount`, `variantValues`) [OPS-916].

## 0.4.1

2026-09-03

### Fixed
- TimeWindow matches Definitions: Start-only, End-only, both, or neither
  (neither → true). Missing side is unconstrained; invalid present side
  fails closed [OPS-856].

## 0.4.0

2026-09-02

### Breaking

- Percentage / Targeting default rollout now use Definitions-aligned SHA-256
  sticky buckets (`featureKey + "\n" + userId`) instead of FNV-1a. Cohorts
  shift for any consumer of the 0.3.x FNV behavior [OPS-832].

### Added

- Segment filters: BrowserFamily, BrowserLanguage, Country / CountryFamily,
  DeviceType, OS / OperatingSystem, UserClaims (sticky `%` with identity,
  random without). Context gains `Claims` and `Request`.
- Golden vector tests under `toggly/eval/testdata/`.
- Dependency on `github.com/mileusna/useragent` (best-effort UA families; may
  differ from `ua-parser-js` / UAParser.NET).

## 0.3.2

2026-09-02

### Fixed
- Register `Microsoft.Targeting` / `Microsoft.Percentage` /
  `Microsoft.TimeWindow` aliases.
- Accept colon-form audience keys alongside dotted form.

## 0.3.1

2026-09-02

### Fixed
- Targeting honors `Audience.Exclusion.Users` / `Audience.Exclusion.Groups`
  before inclusions and default rollout (Definitions parity).
- `IgnoreCase` defaults to `true` when unset (Definitions parity).

## 0.3.0

2026-08-21

### Added
- ContextProperty entity filters (`contextKind` / `contextRequirementType`) with operators eq, neq, gt, gte, lt, lte, in, contains. Fail closed. User filters AND entity filters; percentage stays user-only.
- `EntityContext`, `RegisterContext`, and optional startup PUT `sdk/{appKey}/contexts` (`DisableEntityContextRegistration` to opt out).

## 0.2.0

2026-07-11

### Added
- Snapshot providers store exact signed `defs` JSON (`RawDefs`) and ETag for
  cryptographic verification after a storage round-trip (no re-serialize).
- `Clear` on `snapshot.Provider` for all backends (memory, file, redis, sqlite,
  postgres, mongodb).

### Changed
- `loadSnapshot` verifies raw defs when present; legacy snapshots without
  `RawDefs` load typed features with a warning.
- Signed HTTP refresh persists raw defs after successful verification.

## 0.1.0

2026-07-05

### Added
- Initial Go SDK release versioning via `VERSION` manifest (manifest-first release workflow).
