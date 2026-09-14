## 0.5.0

2026-09-14

### Added
- Support `flutter_secure_storage` 11 alongside retained 9 and 10 through the
  shared read/write/delete API. Stored Toggly keys and injected storage
  instances remain unchanged.
- Compatibility probes for a pre-v10 durable Toggly store, signature metadata,
  JWKS, LRU data, revision keys, and secure-store failure propagation.

### Changed
- Document the required Android migration through a v10 application release
  before a v11 host reads encrypted data created before v10.

## 0.4.0

2026-07-11

### Added
- `readCacheLruIndex` / `writeCacheLruIndex` store the sidecar LRU index under
  secure key `toggly.cache-lru` for `TogglyConfig.maxCacheKeys` eviction
  (`feature_flags_toggly` 1.9.0+).

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
- `SecureStorageCacheProvider` now implements `TogglyRevisionCacheProvider`,
  persisting the definitions revision (ETag) keyed by `appKey`/`environment` so
  cold starts send `If-None-Match` with signed definitions.

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
- Initial release. `SecureStorageCacheProvider`, a `TogglyCacheProvider`
  backed by `flutter_secure_storage`, persisting feature flags, variant
  definitions, and JWKS for offline restart with `feature_flags_toggly`.
