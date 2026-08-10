# Changelog

## 3.4.1

2026-08-10

### Fixed
- WebSocket live refresh now initializes after HTTP 304 (Not Modified), so
  snapshot-warmed instances are not stuck on 5-minute polling (#220).
- While WebSocket is connected, a 20-minute safety poll still runs so a
  half-open connection cannot leave definitions permanently stale.
- Restored Websocket.Client inactivity reconnect (1 minute) instead of
  disabling it with ReconnectTimeout = null.

## 3.4.0

2026-07-13

### Fixed
- `AddToggly(TogglySettings)` now copies `UseSignedDefinitions`, `AllowedKeyIds`, `UndefinedEnabledOnDevelopment`, `OnError`, and `JwksCacheDuration` (previously dropped silently).
- Signed mode refuses snapshots missing `SignedDefsJson` instead of soft-loading unverified typed `Features`.
- Dapper snapshot `TableName` is validated as a SQL identifier to prevent SQL injection via configuration.
- Metrics and usage `GetDebugInfo()` mask the AppKey (same as the feature provider).
- Definitions and JWKS HTTP error logs no longer include remote response bodies at Error level (bodies are Debug-only).

### Changed
- Missing feature filters fail closed by default (`IgnoreMissingFeatureFilters = false`). Opt in to ignore if needed.
- Startup warns when `UseSignedDefinitions` is disabled.

### Added
- `TogglySettings.JwksCacheDuration` (default 30 days) to configure JWKS in-memory/snapshot cache TTL.
- Documentation for trusted `BaseUrl` / `DefinitionsBaseUrl`, signed-defs recommendations, and Debug logging.

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
