# Changelog

## 3.3.0

2026-07-11

### Fixed
- Snapshot load no longer re-serializes feature definitions for signature verification (false `Invalid signature` after RavenDB/storage round-trip). Verification uses the exact signed `defs` JSON stored as `SignedDefsJson`.
- After verifying `SignedDefsJson`, evaluation uses that verified JSON only. If stored typed `Features` are present and diverge from the verified payload, the snapshot is refused (possible storage tampering).
- Definitions revision is read from typed `ETag`, raw `ETag`, or `X-Definitions-Revision` so unquoted worker ETags no longer drop conditional caching.
- Dapper and Entity Framework snapshot providers add `SignedDefsJson` / `ETag` columns to existing tables (CREATE IF NOT EXISTS / EnsureCreated alone do not alter schemas).
- WebSocket `signing-key-updated` clears the JWKS snapshot before refreshing definitions (avoids Clear/Save race).

### Added
- `FeatureDefinitionsSnapshot` with `SignedDefsJson` and `ETag` on `IFeatureSnapshotProvider`.
- `ClearSnapshotAsync` / `ClearJwkSnapshotAsync` on all snapshot providers; `TogglyFeatureProvider.ClearPersistedSnapshotsAsync()`.
- `TogglySettings.OnError` callback for fetch/cache/signature/JWKS failures (also reflected in `GetDebugInfo().LastError`).
- WebSocket `signing-key-updated` handling: clear JWKS cache/snapshot and force definitions refresh.
- Legacy snapshots without `SignedDefsJson` soft-load with a warning (via `OnError` / `LastError`) instead of failing verification; the next successful HTTP refresh upgrades the snapshot.

### Changed
- `IFeatureSnapshotProvider` Save/Get APIs now use `FeatureDefinitionsSnapshot` (breaking for custom providers at 3.3.0).
