
## 0.1.0

2026-05-30

### Added
- Initial release. `SqliteCacheProvider`, a `TogglyCacheProvider` backed by
  `sqflite`, persisting feature flags, variant definitions, and JWKS in a
  single table for offline restart with `feature_flags_toggly`.
