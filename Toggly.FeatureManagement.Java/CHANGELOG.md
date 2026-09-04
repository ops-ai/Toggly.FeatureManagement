# Changelog

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
