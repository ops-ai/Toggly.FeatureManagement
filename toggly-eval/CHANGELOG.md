# Changelog

## 2.0.2

2026-09-03

### Fixed
- TimeWindow matches Definitions: Start-only, End-only, both, or neither
  (neither → true). Missing side is unconstrained; invalid present side
  fails closed [OPS-856].

## 2.0.1

2026-09-03

### Fixed
- Compute sticky SHA-256 buckets with a pure-JS digest so Edge runtimes and
  Turbopack never resolve a static `node:crypto` import (breaks Next.js
  middleware). Golden percentile vectors unchanged.

## 2.0.0

2026-09-02

### Breaking

- Replace FNV-1a `identityBucket` / `rolloutBucket` with Definitions-aligned
  SHA-256 sticky buckets: hash UTF-8 `${featureKey}\n${userId}`, take the
  first 4 bytes as little-endian uint32, then `(value / 0xFFFFFFFF) * 100`.
  Percentage and Targeting default rollout now seed on **featureKey +
  identity** (cohorts shift vs 1.x FNV). Prefer `computePercentile(userId,
  featureKey)`; deprecated aliases remain for transitional imports.

### Added

- Golden vector tests (`testdata/eval-percentile-golden.json`) shared with
  Definitions [OPS-832].
- Segment filters: BrowserFamily, BrowserLanguage, Country / CountryFamily,
  DeviceType, OS / OperatingSystem, UserClaims — sticky `%` when identity is
  present, random otherwise. EvalContext gains `claims` and `request`
  (`userAgent`, `acceptLanguage`, `country`). Uses `ua-parser-js` (same as
  Definitions; UA family strings may still drift vs .NET/Go parsers).
- `fromHttpRequest(headers, extras?)` helper to map User-Agent /
  Accept-Language / CF-IPCountry (and common CDN country headers) into
  `EvalContext.request`.

## 1.0.2

2026-09-02

### Fixed
- Register `Microsoft.Targeting` / `Microsoft.Percentage` /
  `Microsoft.TimeWindow` aliases used by Definitions payloads.
- Accept colon-form audience keys (`Audience:Users:N`,
  `Audience:Exclusion:Users:N`, …) alongside dotted form.

## 1.0.1

2026-09-02

### Fixed
- Targeting honors `Audience.Exclusion.Users` / `Audience.Exclusion.Groups`
  before inclusions and default rollout (Definitions parity).
- `IgnoreCase` defaults to `true` when unset (Definitions parity).

## 1.0.0

2026-09-02

### Added

- Local evaluation engine for `definitions-signed` payloads (parity with Go
  server SDK filters: AlwaysOn, AlwaysOff, Percentage, TimeWindow, Targeting,
  ContextProperty).
- Deterministic FNV-1a rollout buckets matching Go `identityBucket` /
  `rolloutBucket`.
- Helpers to index definitions by feature key and evaluate feature gates.
