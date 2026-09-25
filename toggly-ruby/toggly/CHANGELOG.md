# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-09-24

### Added

- Soft-typed `get_variant_value(feature, as: Klass)` (and optional block form).
  Missing assignment or bind failure returns `nil` — never raises solely for
  shape mismatch. Untyped `get_variant_value` (no `as:`) is unchanged
  [OPS-1365].

## [1.1.0] - 2026-09-23

### Added

- Ambient targeting identity for catalog-local variants: `Config#identity`,
  `Client#identity` / `Client#set_identity`. When `get_variant` /
  `get_variant_value` are called with a nil context or a blank
  `context.identity`, the client identity is used as the allocator
  `userId`. Groups still come only from the per-call context (never Config).
  Prefer config / `set_identity` (or Rails ambient context) over building
  `Context.new(identity: …)` at every call site.
  `Config#identity=` is configuration-time only (`Toggly.configure` /
  `Config.new`); after `Client` is built, use `Client#set_identity`.

## [1.0.0] - 2026-09-23

### Changed (Breaking)

- **Catalog-local, MF-parity feature variants**, replacing the
  `enable_variants` / `evaluated-variants-signed` dual-rail from 0.6.0.
  `Client#get_variant` / `#get_variant_value` now assign variants **locally**
  from the same `variants` / `allocation` payload on the `definitions` /
  `definitions-signed` catalog that drives `enabled?` — there is no separate
  network call. Assignment matches `Microsoft.FeatureManagement` 4.7.0's
  `IVariantFeatureManager` bit-for-bit (user → group → percentile → default,
  `StatusOverride`, percentile SHA-256 hashing) and is verified against the
  shared `variant-allocator-corpus/cases.json` gold corpus (100% pass).
  - `get_variant(feature_key, context: nil)` / `get_variant_value(feature_key,
    context: nil)` now take the same `context:` (`userId` + `groups`) used by
    `enabled?`, instead of a client-wide `variant_identity`.
  - `VariantResult` gains `enabled` (effective enabled after the assigned
    variant's `StatusOverride` — `enabled?` itself stays filter-based only)
    and `reason` (`"User"` | `"Group"` | `"Percentile"` |
    `"DefaultWhenEnabled"` | `"DefaultWhenDisabled"`).
  - New `FeatureDefinition#variants` / `#allocation` (`FeatureVariant`,
    `FeatureVariantAllocation`), parsed from the `definitions` wire.
- **Removed**: `Config#enable_variants` / `#variant_identity` /
  `#variant_groups` / `#variant_claims` / `#variants_endpoint`,
  `Client#variant_defs` / `#set_variant_identity`, `EvaluatedVariantDef`,
  and the `evaluated-variants-signed` fetch/cache rail (including the
  `SnapshotProviders` `save_variants` / `load_variants` hooks — variants are
  now part of the ordinary definitions snapshot via `FeatureDefinition`).

**Migration**: drop `enable_variants` / `variant_identity` /
`set_variant_identity` from your config. Pass targeting via
`get_variant(key, context: Toggly::Context.new(identity: ..., groups: ...))`.

## [0.6.0] - 2026-09-22

### Added

- Server-evaluated feature variants (dual-rail). Set `enable_variants: true`
  on `Config` to additionally fetch `evaluated-variants-signed/{app_key}/
  {environment}` on its own rail alongside the existing `definitions` /
  `definitions-signed` pipeline. `definitions` / `definitions-signed` remain
  the sole source of truth for `enabled?` regardless of `enable_variants` —
  evaluated variants are additive and only feed `get_variant` /
  `get_variant_value`; they never override `enabled?`. New `Config` options:
  `enable_variants`, `variant_identity`, `variant_groups`, `variant_claims`.
  New `Client#get_variant` / `Client#get_variant_value` return the assigned
  variant name and `configuration_value`, or `nil` when unassigned or
  disabled. New `Client#set_variant_identity` updates the `userId` sent to
  `evaluated-variants-signed` and refreshes.
- `SnapshotProviders::Base#save_variants` / `#load_variants` (default no-op)
  so `Memory` and `File` providers persist evaluated variants across
  restarts, independent of the `definitions` snapshot.

**Note:** the new `get_variant` assignment is unrelated to the existing
`variant:` label on `record_usage` / `record_view`, which is a free-form
usage tag (defaults to `"enabled"`/`"disabled"`) and does not reflect
`evaluated-variants-signed` results.

## [0.5.2] - 2026-09-17

### Fixed

- Default usage/metrics gRPC host is `https://metrics.toggly.io/`.

## [0.5.1] - 2026-09-16

### Fixed

- Apply usage/metrics telemetry defaults from the final `app_key` and
  `TOGGLY_DISABLE_TELEMETRY` after `Toggly.configure` and when `app_key` is
  assigned after `Config.new`. Explicit `enable_usage_tracking` /
  `enable_metrics` still win, so setting the key in a configure block no
  longer leaves usage stuck off.

## [0.5.0] - 2026-09-08

### Added

- Definition-refresh cache hit/miss counters on `Usage.SendStats`
  (`definitionCacheHits` / `definitionCacheMisses`), counted once per refresh
  attempt (poll skip, HTTP 304, matching ETag, network error keeping cache =
  hit; new revision applied = miss). Concurrent in-flight skips are not counted.
- Soft-fail restore of the full usage batch (feature stats + hashes + cache
  counters) when `SendStats` fails; cache-only batches still flush.

## [0.4.0] - 2026-09-06

### Added

- Batched usage (`Usage.SendStats`) and business metrics (`Metrics.SendMetrics`)
  telemetry with ~1 minute flush and best-effort flush on `close` / `at_exit`.
- Public client APIs: `record_usage`, `record_view`, `measure`,
  `increment_counter`, `observe`, `flush_telemetry`.
- Auto `record_check` from `enabled?` when usage tracking is enabled.
- Config: `enable_usage_tracking`, `enable_metrics`, `metrics_base_url`,
  flush intervals; set `TOGGLY_DISABLE_TELEMETRY=1` to disable globally.
- Optional `grpc` + `google-protobuf` transport (core gem stays zero required
  runtime deps); gRPC metadata `ua` = `toggly-ruby/{VERSION}`.
- FNV-1a UTF-8 signed int32 identity hashing with golden vectors matching
  Go/Node/Python; `variantStats` / `variantValues` wire fields.

### Fixed

- Assign full `Google::Protobuf::Timestamp` objects for nested time fields
  (FeatureStat/MetricStat/observations) instead of mutating nil fields.
- Cooperative flush-timer stop on `close` (condition wake + join timeout)
  instead of `Thread#kill` during an in-flight send.

## [0.3.0] - 2026-09-04

### Added

- EvalContext fields `claims` and `request` (`userAgent`, `acceptLanguage`,
  `country`) plus `Toggly::RequestContext` and `Toggly::HttpRequestMapper`
  (headers → request; country order `cf-ipcountry` → `x-vercel-ip-country` →
  `cloudfront-viewer-country`).
- Segment filters: `BrowserFamily`, `BrowserLanguage`, `Country` /
  `CountryFamily`, `DeviceType`, `OS` / `OperatingSystem` with indexed params
  and Percentage fail-closed gating.
- `UserClaims` filter (`Claim` + `Value`).
- `Microsoft.Percentage`, `Microsoft.TimeWindow`, and `Microsoft.Targeting`
  aliases; golden fixtures under `docs/filter-parity/fixtures/`.

### Changed

- Sticky percentage hashing now uses Definitions / toggly-eval SHA-256
  (`featureKey + "\n" + userId`, little-endian uint32 / `0xFFFFFFFF * 100`)
  instead of FNV-1a. Existing sticky cohorts shift when upgrading from 0.2.x.
- Unknown filter names fail closed.
- Percentage missing or `≤0` fails closed (aligned with filter-parity contract).

## [0.2.1] - 2026-09-03

### Changed

- Raise required Ruby version to 3.2+ (matches Gemfile.lock Bundler and CI).

## [0.2.0] - 2026-08-21

### Added

- ContextProperty entity filters (`context_kind` / `context_requirement_type`) with operators eq, neq, gt, gte, lt, lte, in, contains. Fail closed. User filters AND entity filters; percentage stays user-only.
- `Toggly::EntityContext`, `Toggly.register_context`, and optional startup PUT `sdk/{appKey}/contexts` (`disable_entity_context_registration` to opt out).

## [0.1.0] - 2024-XX-XX

### Added

- Initial release of Toggly Ruby SDK
- `toggly` - Core SDK with zero dependencies
  - Client for feature flag evaluation
  - Context for user identity, groups, and traits
  - Evaluation engine with multiple rule types
  - Percentage rollouts with consistent hashing
  - User and group targeting
  - Contextual targeting with operators
  - Time window rules
  - Memory and file snapshot providers
  - Background refresh support
  - Offline mode with defaults

- `toggly-rails` - Rails integration
  - Railtie for auto-configuration
  - Controller concern with `feature_enabled?` helper
  - View helpers (`when_feature_enabled`, `feature_switch`)
  - Rack middleware for request context
  - Context builder from current_user
  - Rails.cache snapshot provider
  - Generator for initializer
  - Rake tasks (list, check, refresh, config)
  - RSpec and Minitest helpers

- `toggly-cache` - Redis caching support
  - Redis snapshot provider
  - Connection pool support
  - TTL configuration
  - Touch/extend TTL support
