
## 0.2.2

2026-07-06

### Changed
- Verified compatibility with `feature_flags_toggly` 1.6.x (setContext,
  SDK identity on definitions traffic, ETag WebSocket sync).

### Fixed
- Stopped tracking `pubspec_overrides.yaml` in git (use
  `pubspec_overrides.yaml.example`) so pub.dev publish validation passes.

## 0.2.1

2026-06-15

### Fixed
- Corrected the `repository` URL in `pubspec.yaml` to the reachable monorepo
  location (`ops-ai/Toggly.FeatureManagement`) so pub.dev can verify it.

## 0.2.0

2026-06-15

### Changed
- Switched from the unmaintained `isar`/`isar_flutter_libs`/`isar_generator`
  packages to the community-maintained fork: `isar_community`,
  `isar_community_flutter_libs`, and `isar_community_generator` (`^3.3.2`).
  The fork is API-compatible with Isar v3; imports now use
  `package:isar_community/isar.dart`. No public API changes.

## 0.1.0

2026-05-30

### Added
- Initial release. `IsarCacheProvider`, a `TogglyCacheProvider` backed by the
  Isar database, persisting feature flags, variant definitions, and JWKS for
  offline restart with `feature_flags_toggly`.
