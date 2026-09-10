# Changelog

## 0.6.0

2026-09-08

### Added
- Definition-refresh cache hits and misses (`definitionCacheHits` /
  `definitionCacheMisses`) on `Usage.SendStats` [OPS-991].
- In-flight refresh guard; concurrent skip does not count. Scheduled poll
  skip (live WS) counts as a hit; WebSocket-forced refresh is not suppressed
  by poll skip and counts a miss when a new revision applies.
- Shared `definition_cache` helpers for ETag / Last-Modified / signed
  timestamp classification.

### Changed
- Usage batcher restores the full batch (feature stats, hashes, cache
  counters) on `SendStats` failure, merging with in-flight records.
- Cache-only usage batches still flush when only cache counters are pending.
- Equal signed timestamp / ETag / Last-Modified on refresh counts as a hit
  (`<=`, not only older).
- Error-path hits require a previously loaded revision (empty `{}` still
  counts as loaded).
- Workspace package version bumped to 0.6.0; path dependency pins updated.
- User-Agent is `toggly-rust/0.6.0`.

## 0.5.0

2026-09-06

### Added
- Optional Cargo feature `telemetry` (tonic/prost) for batched
  `Usage.SendStats` and `Metrics.SendMetrics` gRPC export to Toggly.
- In-process usage/metrics batchers with ~1 minute flush, flush on
  `close` / `flush_telemetry`, multi-variant `variantStats` /
  `variantValues`, FNV-1a UTF-8 signed int32 identity hashes, and `UA`
  metadata (`toggly-rust/{version}`).
- Config opt-in: `enable_usage_tracking`, `enable_metrics`,
  `metrics_base_url`, flush intervals; auto `record_check` from
  `is_enabled` when usage tracking is on.
- Soft-fail send errors (eval unaffected); restore unique maps/counters
  into batchers after a failed send.

### Changed
- Workspace package version bumped to 0.5.0; path dependency pins updated.
- Existing Cargo feature `metrics` remains local Prometheus only — distinct
  from Toggly gRPC telemetry.
- Without the `telemetry` feature, usage/metrics tracking defaults off and
  recording is a no-op (no unbounded identity buffering). Enable
  `toggly/telemetry` (or inject senders in tests) to record and export.
- `tonic-build` is an optional build-dependency gated by `telemetry`, so
  feature-off builds do not pull prost/tonic build tooling.

## 0.4.0

2026-09-04

### Added
- EvalContext fields `claims` and `request` (`userAgent` / `user_agent`,
  `acceptLanguage` / `accept_language`, `country`) plus `RequestContext` and
  `HttpRequestMapper` (headers → request; country order `cf-ipcountry` →
  `x-vercel-ip-country` → `cloudfront-viewer-country`).
- Segment filters: `BrowserFamily`, `BrowserLanguage`, `Country` /
  `CountryFamily`, `DeviceType`, `OS` / `OperatingSystem` with indexed params
  and Percentage fail-closed gating.
- `UserClaims` filter (`Claim` + `Value`).
- `Microsoft.Percentage`, `Microsoft.TimeWindow`, and `Microsoft.Targeting`
  aliases; golden fixtures under `docs/filter-parity/fixtures/`.

### Changed
- Sticky percentage hashing now uses Definitions / toggly-eval SHA-256
  (`featureKey + "\n" + userId`, little-endian uint32 / `0xFFFFFFFF * 100`)
  instead of identity+feature big-endian digest. Existing sticky cohorts shift
  when upgrading from 0.3.x.
- Percentage missing or `≤0` fails closed; anonymous Percentage fails closed
  (aligned with filter-parity contract).
- Targeting accepts Definitions `Audience.Users:` / `Audience.Groups:` indexed
  params and related default rollout keys.
- Unknown filter names fail closed.
- Workspace package version bumped to 0.4.0; path dependency pins updated.

## 0.3.1

2026-08-28

### Changed
- Public crates.io metadata: author `Toggly <support@toggly.io>`, repository URL to `ops-ai/Toggly.FeatureManagement`.
- Release workflow uses crates.io Trusted Publishing (OIDC) via `rust-lang/crates-io-auth-action`, with `CARGO_REGISTRY_TOKEN` fallback until Trusted Publishers are configured on each crate.

## 0.3.0

2026-08-21

### Added
- ContextProperty entity filters (`context_kind` / `context_requirement_type`) with operators eq, neq, gt, gte, lt, lte, in, contains. Fail closed. User filters AND entity filters; percentage stays user-only.
- `TogglyEntityContext`, schema registration, and optional startup PUT `sdk/{appKey}/contexts` (`disable_entity_context_registration` to opt out).

## 0.2.0

2026-07-11

### Added
- ES256 signed definitions verification using exact raw `defs` JSON bytes + timestamp (double SHA-256), matching Go `crypto/verify.go`.
- In-memory JWKS cache with refresh on `signing-key-updated` WebSocket messages.
- `clear_cache()` now clears evaluation cache, in-memory definitions, ETag/revision, and JWKS.
- `on_error` callback, `last_error()`, and last-known-good preservation on refresh/verify failure.
- Persist and use ETag / `X-Definitions-Revision` for conditional fetches and WebSocket `?rev=`.

### Changed
- Workspace package version bumped to 0.2.0.
