# Changelog

## 0.3.1

2026-09-02

### Fixed
- Targeting honors `Audience.Exclusion.Users` / `Audience.Exclusion.Groups`
  before inclusions and default rollout (Definitions parity).
- `IgnoreCase` defaults to `true` when unset (Definitions parity).

## 0.3.0

2026-08-21

### Added
- ContextProperty entity filters (`contextKind` / `contextRequirementType`) with operators eq, neq, gt, gte, lt, lte, in, contains. Fail closed. User filters AND entity filters; percentage stays user-only.
- `EntityContext`, `RegisterContext`, and optional startup PUT `sdk/{appKey}/contexts` (`DisableEntityContextRegistration` to opt out).

## 0.2.0

2026-07-11

### Added
- Snapshot providers store exact signed `defs` JSON (`RawDefs`) and ETag for
  cryptographic verification after a storage round-trip (no re-serialize).
- `Clear` on `snapshot.Provider` for all backends (memory, file, redis, sqlite,
  postgres, mongodb).

### Changed
- `loadSnapshot` verifies raw defs when present; legacy snapshots without
  `RawDefs` load typed features with a warning.
- Signed HTTP refresh persists raw defs after successful verification.

## 0.1.0

2026-07-05

### Added
- Initial Go SDK release versioning via `VERSION` manifest (manifest-first release workflow).
