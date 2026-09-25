# Changelog

## 1.1.0 - 2026-09-24

### Added
- Optional typed soft-bind on `get_variant_value(..., type=T)` for sync and
  async clients. Without `type`, behavior is unchanged (untyped `Any`). With
  `type`, binds via pydantic `TypeAdapter` when pydantic is importable,
  otherwise a best-effort local decode. Missing assignment or decode/bind
  failure returns `None` — never raises solely for shape mismatch [OPS-1365].

## 1.0.0 - 2026-09-23

### Breaking Changes
- Feature variants are now assigned **locally** from cached feature
  definitions instead of fetched from a separate `evaluated-variants-signed`
  endpoint. Assignment matches Microsoft.FeatureManagement 4.7.0 exactly:
  disabled features only resolve `DefaultWhenDisabled`; enabled features
  resolve via per-user allocation, then per-group allocation, then
  percentile allocation, then `DefaultWhenEnabled`.
- Removed `TogglyConfig.enable_variants`, `variant_groups`, and
  `variant_claims`. There is no longer a separate "variants mode" — variant
  assignment is always available for any feature that defines `variants` and
  an `allocation` in its definition.
- Removed the `EvaluatedVariantDef` model, the `VariantsSnapshot` cache
  entry, and the snapshot-provider `load_variants` / `save_variants` hooks.
  Custom `SnapshotProvider` implementations no longer need to implement
  those methods.

### Added
- `get_variant(feature_key, *, user_id=None, groups=None)` and
  `get_variant_value(...)` on both `TogglyClient` and `AsyncTogglyClient`,
  with an optional per-call targeting overload (falls back to
  `TogglyConfig.identity` when `user_id` is omitted).
- `VariantResult.enabled` (effective enabled state after the assigned
  variant's `StatusOverride`) and `VariantResult.assignment_reason`
  (`"User"`, `"Group"`, `"Percentile"`, `"DefaultWhenEnabled"`,
  `"DefaultWhenDisabled"`, or `"None"`).
- `Variant`, `Allocation`, `UserAllocation`, `GroupAllocation`, and
  `PercentileAllocation` models parsed from the `variants` / `allocation`
  fields on feature definitions.
- `assign_variant` / `VariantAssignment` in `toggly.variants`, validated
  against the shared cross-SDK Microsoft.FeatureManagement parity corpus
  (100% of cases pass).

### Migration
- Replace `TogglyConfig(enable_variants=True, identity=..., variant_groups=...,
  variant_claims=...)` with plain `TogglyConfig(identity=...)`, and call
  `client.get_variant(feature_key, user_id=..., groups=[...])` per request
  instead of relying on client-wide variant context.
- Feature variants must be defined on the feature itself (`variants` +
  `allocation`) rather than fetched separately; this matches how variants are
  authored in the Toggly dashboard.

## 0.7.2 - 2026-09-17

### Fixed
- Default usage/metrics gRPC host is `https://metrics.toggly.io`.

## 0.7.1 - 2026-09-12

### Changed
- Declare Python 3.14 compatibility and add packed-host validation for the
  core package and optional WebSocket and gRPC transports. Python 3.8 remains
  the declared minimum.

## 0.7.0 - 2026-09-08

### Added
- Initial application-wide variant groups and string claims, alongside identity.

### Fixed
- Snapshot startup targeting, encode the full variants query, partition cached results and validators by complete context, and discard responses from superseded identities.


## 0.6.0

2026-09-07

### Added
- Report `definitionCacheHits` / `definitionCacheMisses` on usage `SendStats`
  for definition-refresh outcomes (304, skipped poll, durable snapshot, network
  keep-last-good → hit; new revision applied → miss), matching Node/.NET.
- In-flight refresh guard so concurrent skips are not counted.
- On `SendStats` failure, restore the full usage batch (feature stats, unique
  hashes, and cache counters), merging with any in-flight records.

## 0.5.0

2026-09-06

### Added
- Batched gRPC telemetry for feature usage (`Usage.SendStats`) and business
  metrics (`Metrics.SendMetrics`), matching .NET / Go / Node payload shape
  (`variantStats` / `variantValues`, UTF-8 FNV-1a identity hashes, `ua`
  metadata — same semantics as .NET/Go/Node `UA`; lowercase for grpcio).
- Public APIs: `record_usage`, `record_view`, `measure`, `increment_counter`,
  `observe`, `flush_telemetry`; automatic check recording from `is_enabled`
  when usage tracking is enabled.
- Optional `telemetry` extra (`grpcio` + `protobuf`) so core evaluate stays
  zero-dependency; install with `pip install toggly[telemetry]`
  (`grpcio>=1.80` on Python ≥3.9; `grpcio>=1.62,<1.71` on Python 3.8).
  Generated stub floor is `1.62.0` so both install lines can import the
  native path.
- Config: `enable_metrics` (default on), `metrics_base_url`, flush intervals,
  `instance_name`, `app_version`.

## 0.4.0

2026-09-04

### Added
- Server-side filter parity with `@ops-ai/toggly-eval` / Definitions: segment filters
  (`BrowserFamily`, `BrowserLanguage`, `Country`/`CountryFamily`, `DeviceType`,
  `OS`/`OperatingSystem`), `UserClaims`, and `AlwaysOff`.
- `EvaluationContext` claims + `RequestContext` (user_agent, accept_language, country)
  and `HttpRequestMapper.from_http_headers` for CF/Vercel/CloudFront country headers.
- Microsoft.* aliases for Percentage, TimeWindow, and Targeting.
- Golden fixture tests loading `docs/filter-parity/fixtures/`.

### Changed
- Percentage / segment sticky buckets now use Definitions SHA-256
  (`featureKey\nuserId`) instead of FNV-1a (cohort shift for identified rollouts).

## 0.3.0

2026-08-21

### Added
- ContextProperty entity filters (`context_kind` / `context_requirement_type`) with operators eq, neq, gt, gte, lt, lte, in, contains. Fail closed. User filters AND entity filters; percentage stays user-only.
- `TogglyEntityContext`, `register_context`, and optional startup PUT `sdk/{appKey}/contexts` (`register_contexts_on_startup`, default True).

## 0.2.1

2026-07-12

### Fixed
- Ruff lint: import sorting, unused import, nested `with` in `FileSnapshotProvider.clear_jwks`.

## 0.2.0

2026-07-11

### Added
- Real ES256 signed-definitions verification (double SHA-256 + ECDSA P-256, IEEE P1363 or DER).
- `signed_defs_json` on `DefinitionsSnapshot` for cache re-verification from raw bytes.
- `on_error` config callback and last-known-good behavior on transient failures.
- WebSocket `signing-key-updated` clears JWKS and forces refresh.
- `clear_jwks()` on snapshot providers; `clear_cache()` clears definitions + JWKS.

### Fixed
- `use_signed_definitions` previously fetched the signed endpoint without verifying signatures.
