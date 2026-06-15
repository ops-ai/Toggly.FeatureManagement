
## 0.1.1

2026-06-15

### Fixed
- Corrected the `repository` URL in `pubspec.yaml` to the reachable monorepo
  location (`ops-ai/Toggly.FeatureManagement`) so pub.dev can verify it.

## 0.1.0

2026-05-30

### Added
- Initial release. `SecureStorageCacheProvider`, a `TogglyCacheProvider`
  backed by `flutter_secure_storage`, persisting feature flags, variant
  definitions, and JWKS for offline restart with `feature_flags_toggly`.
