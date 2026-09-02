# Changelog

## 1.0.0

2026-09-02

### Added

- Local evaluation engine for `definitions-signed` payloads (parity with Go
  server SDK filters: AlwaysOn, AlwaysOff, Percentage, TimeWindow, Targeting,
  ContextProperty).
- Deterministic FNV-1a rollout buckets matching Go `identityBucket` /
  `rolloutBucket`.
- Helpers to index definitions by feature key and evaluate feature gates.
