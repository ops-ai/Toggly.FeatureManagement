# Changelog

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
