# Changelog

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
