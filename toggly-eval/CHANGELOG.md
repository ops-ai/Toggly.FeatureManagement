# Changelog

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
