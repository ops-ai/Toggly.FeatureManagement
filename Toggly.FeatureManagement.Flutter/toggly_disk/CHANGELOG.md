
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
- Initial release. `DiskCacheProvider`, a `TogglyCacheProvider` that persists
  feature flags, variant definitions, and JWKS as plain JSON files on disk
  (atomic writes) for offline restart with `feature_flags_toggly`.
