# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
