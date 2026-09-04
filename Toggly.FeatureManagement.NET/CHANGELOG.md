# Changelog

## 3.6.0

2026-09-02

### Changed
- Sticky SHA-256 percentile buckets now match Cloudflare Definitions /
  `@ops-ai/toggly-eval` / Go: UTF-8 `${featureKey}\n${userId}`, little-endian
  first 4 bytes → `[0, 100)`. Stock Microsoft.FeatureManagement order
  (`${userId}\nhint`) is no longer used for Percentage or Targeting default
  rollout (cohorts shift vs prior MF hashing / random Percentage).
- Web segment filters (BrowserFamily, BrowserLanguage, Country, DeviceType, OS,
  UserClaims) use the same sticky bucket when a targeting user id is available;
  otherwise they keep the previous non-sticky random gate.

### Added
- Public `Percentile.Compute` / `Percentile.IsInRollout` helper and golden-vector
  tests (`testdata/eval-percentile-golden.json`).
- `TogglyPercentageFilter` and `TogglyTargetingFilter` registered by
  `AddTogglyFeatureManagement` (stock `PercentageFilter` / `TargetingFilter`
  removed to avoid ambiguous filter matches).
- `WithTogglyTargeting<T>` — prefer over Microsoft's `WithTargeting` so stock
  targeting is not re-registered.

## 3.5.0

2026-08-19

### Added
- Entity context evaluation for server-side targeting: `AddTogglyEntityContext<T>`,
  `ITogglyEntityContextResolver`, `ContextPropertyFilter`, and split user/entity
  evaluation in `TogglyFeatureManager`.
- Razor `<feature context="@entity">` tag helper in `Toggly.FeatureManagement.Web`.
- Optional startup registration of discovered context schemas via
  `RegisterContextsOnStartup` (default true).
- Usage stats identifiers now include entity kind/key (`user|Kind|key`) for
  per-instance list checks.

### Fixed
- Razor tag helper now targets the `<feature>` element, defaults
  `requirement` to `All`, splits comma-separated `name` values, and
  documents `@removeTagHelper` for Microsoft's
  `Microsoft.FeatureManagement.Mvc.TagHelpers.FeatureTagHelper`.
- Entity-only flags evaluate without a user filter; empty `EnabledFor` after
  stripping `ContextProperty` no longer forces the flag off.
- `AddToggly` registers an empty `EntityContextRegistry` so existing apps do
  not crash when they have not called `AddTogglyEntityContext`.
- Startup catalog PUT is fire-and-forget and no longer retries HTTP 404.

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
