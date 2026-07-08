## 0.3.0

2026-07-07

### Changed
- Definitions revision keys now include evaluation identity (user/groups/claims)
  alongside `appKey` and `environment`, matching `feature_flags_toggly` 1.8.0.
- Reads migrate legacy `appKey`/`environment`-only revision entries to the
  identity-scoped key automatically.

## 0.2.0

2026-07-07

### Added
- `SqliteCacheProvider` now implements `TogglyRevisionCacheProvider`, persisting
  the definitions revision (ETag) keyed by `appKey`/`environment` so cold
  starts send `If-None-Match` with signed definitions.

## 0.1.2

2026-07-06

### Fixed
- Added `.pubignore` so build and tooling artifacts are excluded from the
  published archive (same pattern as the core SDK and Isar provider).
- Stopped tracking `pubspec_overrides.yaml` in git (use
  `pubspec_overrides.yaml.example`) so pub.dev publish validation passes.

### Changed
- Verified compatibility with `feature_flags_toggly` 1.6.x (setContext,
  SDK identity on definitions traffic, ETag WebSocket sync).

## 0.1.1

2026-06-15

### Fixed
- Corrected the `repository` URL in `pubspec.yaml` to the reachable monorepo
  location (`ops-ai/Toggly.FeatureManagement`) so pub.dev can verify it.

## 0.1.0

2026-05-30

### Added
- Initial release. `SqliteCacheProvider`, a `TogglyCacheProvider` backed by
  `sqflite`, persisting feature flags, variant definitions, and JWKS in a
  single table for offline restart with `feature_flags_toggly`.
