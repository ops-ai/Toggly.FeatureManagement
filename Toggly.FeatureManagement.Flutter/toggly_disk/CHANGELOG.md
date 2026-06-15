
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
