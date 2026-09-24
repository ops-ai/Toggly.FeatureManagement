# Changelog

## Unreleased

### Added
- `toggly-axum08` 0.2.0, a separate Axum 0.8 adapter. `toggly-axum` remains
  the Axum 0.7 adapter, so existing applications keep their dependency types
  and imports.

## 0.8.0

### Added
- Ambient / config identity for catalog-local variants: `TogglyConfig::identity`,
  `TogglyClientBuilder::identity`, `TogglyClient::set_identity` /
  `identity` / `clear_identity`. When `EvalContext` has no identity,
  `get_variant` / `get_variant_value` fill from the client default so
  `get_variant(key, EvalContext::default())` works after config or
  `set_identity` [OPS-1407].
- HTTP adapters: request-scoped `Feature` continues to extract identity from
  headers into `EvalContext`; call
  `feature.client().get_variant(key, feature.context().clone())` so empty
  ambient identity falls through to config / `set_identity`. Actix `Feature`
  now exposes `client()` for that pattern [OPS-1407].

## 0.7.0

### Added
- Catalog-local feature variants: `TogglyClient::get_variant` /
  `get_variant_value`, `toggly::definitions::{Variant, Allocation,
  UserAllocation, GroupAllocation, PercentileAllocation, StatusOverride}`,
  and `toggly::eval::{assign_variant, AssignmentReason, VariantAssignment}`.
  Assignment (user → group → percentile → `DefaultWhenEnabled` /
  `DefaultWhenDisabled`, percentile SHA-256 hash, `StatusOverride` applied to
  the effective enabled state) matches `Microsoft.FeatureManagement` 4.7.0
  (`IVariantFeatureManager`) bit-for-bit; verified against the shared
  `variant-allocator-corpus` gold corpus (18/18 cases). No dual-rail network
  call — variants are parsed from the same definitions catalog that already
  drives `is_enabled` [OPS-1395].
- `TogglyConfig::variant_ignore_case` /
  `TogglyClientBuilder::variant_ignore_case` for case-insensitive user/group
  targeting, mirroring `TargetingEvaluationOptions.IgnoreCase` (default
  `false`) [OPS-1395].

## 0.6.3

2026-09-17

### Fixed
- Default usage/metrics gRPC host is `https://metrics.toggly.io/`.

## 0.6.2

2026-09-17

### Changed
- `reqwest` bumped from 0.11 to 0.12 and `tokio-tungstenite` from 0.21 to
  0.24, moving both off `rustls` 0.21/0.22 and their vulnerable
  `rustls-webpki` 0.101.7 / 0.102.8 (RUSTSEC-2026-0049, -0098, -0099,
  -0104) onto `rustls-webpki` 0.103.15. `cargo-audit` 0.22.2 (which, unlike
  0.21.2, can parse the current advisory DB) now flags these correctly;
  `reqwest::Client` and `tokio_tungstenite::connect_async` usage in the
  definitions provider is unchanged (no public API impact).
- `.cargo/audit.toml` now documents one remaining, deliberately-ignored
  advisory (`RUSTSEC-2026-0258` for `h2` 0.3.27). That `h2` line is
  unrelated to `reqwest`/`tokio-tungstenite` — it comes from
  `actix-http`/`rocket_http`'s `hyper` 0.14 dependency in `toggly-actix` /
  `toggly-rocket`, and no patched `h2` 0.3.x release exists upstream
  [OPS-1258].

## 0.6.1

2026-09-16

### Changed
- `toggly-actix` now accepts Actix-web 4.15. The supported range is
  `actix-web >=4.4, <4.16` (0.6.0 stopped at `<4.13`).

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
