# Changelog

## All .NET SDK packages 3.12.13 - 2026-10-05

### Changed
- Web feature tag helpers reuse the separator used to parse feature names,
  reducing repeated allocations when rendering feature-gated content.
- Expanded Web XML API documentation for HTTP feature contexts, targeting
  accessors, and feature tag helpers.

## All .NET SDK packages 3.12.12 - 2026-10-05

### Changed
- `Toggly.FeatureManagement.Storage.EntityFramework` computes the same SHA-256
  catalog IDs without creating a hash instance for each lookup. Missing
  catalog-store dependencies and registration arguments still fail immediately.

## All .NET SDK packages 3.12.11 - 2026-10-04

### Fixed
- `Toggly.FeatureManagement.NSwag` generates OpenAPI documents per request by
  default, so request-scoped feature gates cannot reuse another request's
  schema. Applications can opt into bounded caching with an explicit document
  key that distinguishes their document variants.

## All .NET SDK packages 3.12.10 - 2026-10-04

### Fixed
- `Toggly.FeatureManagement.Storage.RavenDB` now preserves a configured
  `JwkDocumentName` when registering the snapshot provider with a settings
  object, so JWK snapshots use the requested document name.

### Changed
- RavenDB snapshot contracts and document-name settings now declare nullable
  values explicitly, matching absent feature definitions and optional settings.

## All .NET SDK packages 3.12.9 - 2026-10-04

### Changed
- `Toggly.FeatureManagement.Storage.DistributedCache` now explicitly marks
  optional snapshot fields and cache entry names as nullable, matching their
  existing defaults, and documents its public snapshot and registration APIs.
- Distributed-cache catalog storage uses the available validation and hashing
  APIs on each supported framework while preserving catalog cache keys and
  process-wide writer serialization.

## All .NET SDK packages 3.12.8 - 2026-10-04

### Fixed
- Dashboard conflict pages now generate reload links from the configured
  routes, so nested mounts, host path bases, and encoded feature keys open
  the current catalog or feature correctly.
- Dashboard packages no longer include generated development reports as
  application content.

## All .NET SDK packages 3.12.7 - 2026-10-03

### Fixed
- The SDK User-Agent version now matches the NuGet package version even when
  CI injects a different assembly informational version. Malformed assembly
  informational versions fall back to a valid file or assembly version.

## All .NET SDK packages 3.12.6 - 2026-09-30

### Fixed
- Web request targeting filters now ignore empty configuration values and
  return a non-match instead of throwing when an allow-list contains a
  missing value.

## All .NET SDK packages 3.12.5 - 2026-09-29

### Fixed
- `Toggly.FeatureManagement.Embedded` now requests catalog-read cancellation
  asynchronously after a failed or timed-out refresh, so store callbacks
  do not run synchronously in the refresh continuation. Diagnostics still
  update after those callbacks finish.

## All .NET SDK packages 3.12.4 - 2026-09-29

### Fixed
- `Toggly.Metrics.SystemMetrics` now reads and clears collected observations
  atomically with counter updates, preventing lost measurements and collection
  errors when the collector and metrics reporter run concurrently.
- Counter events without a name or payload are ignored safely.

## All .NET SDK packages 3.12.3 - 2026-09-29

### Fixed
- `Toggly.FeatureManagement.NSwag` now uses the request origin when a
  forwarded protocol or host header is blank, so OpenAPI document generation
  does not fail on empty proxy header values.

## All .NET SDK packages 3.12.2 - 2026-09-29

### Fixed
- `Toggly.FeatureManagement.NSwag` improves feature-gate processing during
  OpenAPI document generation. Middleware setup safely initializes default
  options, preserves request cancellation, and tolerates empty forwarded
  headers.

## All .NET SDK packages 3.12.1 - 2026-09-29

### Changed
- Simplified HealthChecks evaluation while retaining existing health status
  and diagnostic values for unavailable definitions, required features without
  `AlwaysOn`, and definition refresh errors.

## All .NET SDK packages 3.12.0 - 2026-09-28

### Added
- Target `net10.0` on core FeatureManagement packages that previously stopped
  at `net9.0`, retaining `netstandard2.1` through `net9.0` [OPS-1565].
- `Microsoft.Extensions.Http.Polly` 10.0 for the `net10.0` TFM.

## All .NET SDK packages 3.11.2 - 2026-09-28

### Changed
- The internal context-hashing helper can no longer be instantiated. Public
  APIs and feature-evaluation behavior are unchanged.

## All .NET SDK packages 3.11.1 - 2026-09-28

### Fixed
- Apply HTTP 200 definition bodies even when the response revision matches the
  cached ETag, so a refresh cannot keep a stale in-memory snapshot after a
  successful definitions fetch.
- Pin the Azure Web PubSub dependency graph to preserve restore compatibility
  with .NET Standard 2.1 and .NET Core 3.1 applications.

## All .NET SDK packages 3.11.0 - 2026-09-24

### Added
- `IVariantFeatureManager.GetVariantValueAsync<T>` soft-binds the assigned
  variant's `Configuration` to `T` (object or scalar). Returns `default` when
  no variant is assigned or binding fails; does not throw for shape mismatch.
  Existing Microsoft.FeatureManagement `GetVariantAsync` APIs are unchanged.

## All .NET SDK packages 3.10.0 - 2026-09-19

### Added
- Portable/Desktop and Blazor WebAssembly clients accept minted identities for definitions and telemetry, with an atomic context/token replacement API.

### Fixed
- Frontend events retain their accepted identity across login, logout and retries; minted tokens partition cached signed definitions. Trusted server evaluation and telemetry remain unchanged.


## All .NET SDK packages 3.9.0 - 2026-09-18

### Added
- Portable/Desktop and Blazor WebAssembly clients support aggregate frontend checks, explicit usage/views and business metrics with opt-out and bounded transport. Trusted server telemetry is unchanged.


## All .NET SDK packages 3.8.1 - 2026-09-17

### Fixed
- Usage and metrics ingest default to `https://metrics.toggly.io/`. Product
  API calls stay on `https://app.toggly.io/`. Set `MetricsBaseUrl` to override.

## All .NET SDK packages 3.8.0 - 2026-09-14

### Added
- Optional feature `category` on the portable catalog, and `AlwaysOn` as a
  known empty targeting filter.
- SaaS-aligned embedded dashboard: official wordmark, pill header tabs,
  feature cards, category browse, Copy C# `FeatureFlags` enum, and an inline
  conditions panel. Settings save metadata only; turning a feature off and
  saving clears targeting filters.
- Reusable catalog `lists` (named identifier bags) and a Lists tab. Targeting
  slots link one list key; evaluation expands keys to indexed IDs.
- Collapsed feature cards show SaaS-style “Conditionally enabled” copy for
  non-Always On filters, including linked list names.

### Fixed
- Copy C# enum members stay unique when sanitized keys collide with later keys.
- Conditions drafts restore on Cancel, hide Remove for a group's sole
  condition, and trap focus in the Copy C# modal.
- A persisted-on feature toggle expands the conditions draft and stays on;
  only Turn feature off starts the off draft.
- Turning the draft back on after Turn feature off restores the switch as well
  as the On/Off enabled state.
- Uncategorized features round-trip as an empty category instead of null.
- Conditions can be opened without JavaScript via the Conditions link.
  The card toggle and Turn feature off set on/off; there is no Feature state
  radio group.
- Import preview treats a missing category and an empty category as the same
  uncategorized feature.
- Visible focus ring on the feature toggle track; selected Browse link and
  12px captions meet AA contrast.
- Disable Turn feature off in read-only mode, show a disabled Create feature
  control instead of hiding it, and validate category length after trim.
- Conditions Save no longer raises a native leave prompt, and changing the Add
  user filter dropdown does not count as a dirty draft.

### Changed
- `DashboardFeatureInput.Enabled` is `bool?` so a conditions POST can require an
  explicit true or false rather than treating a missing field as false.
- List-page enable/disable is `POST …/features/conditions` only; the former
  `POST …/features/state` route is removed.
- Targeting catalog parameters store list keys instead of indexed identifier
  literals. Empty enabled Save is rejected; Always On is added only when the
  operator chooses it.

## All .NET SDK packages 3.7.0 - 2026-09-13

### Changed
- Unify server, catalog, embedded, dashboard, distributed client, desktop and
  Blazor package/assembly versions under the common .NET SDK version.
- Keep internal SDK dependencies on the same version across every package.

## Toggly.FeatureManagement 3.7.0 - 2026-09-12

### Added
- Shared evaluation registration, runtime-mode conflict detection, and coherent
  evaluation snapshots for the embedded runtime without cloud services.

## Toggly.FeatureManagement.Dashboard 0.1.0 - 2026-09-12

### Added
- Offline, server-rendered dashboard pages for catalog initialization, feature
  editing, targeting rules, contexts, storage diagnostics, export, import
  preview, and Cloud migration guidance.
- Host-controlled authorization, antiforgery protection, revision-aware writes,
  and private no-store responses for every dashboard resource.
- Desktop and no-JavaScript mobile browser coverage against the SQLite host,
  including immediate SDK evaluation, import/export, and literal targeting IDs.

### Fixed
- Preserve explicit 100% rules, targeting exclusions, case matching, entity
  operators, claim percentages, and tags containing commas during editing.
- Reject all read-only POSTs and forwarded localhost access; reject editable
  mounts against reader stores. Preserve submitted values on stale edits.
- Apply dashboard-specific form limits before antiforgery so valid catalogs up
  to the configured limit can complete preview and apply.

## Toggly.FeatureManagement.Storage.DistributedCache 3.7.0 - 2026-09-12

### Added
- Conditional, process-local single-writer catalog storage for offline embedded feature dashboards, with explicit reader replicas and isolated cache keys.

## Toggly.FeatureManagement.Storage.RavenDB 3.7.0 - 2026-09-12

### Added
- Optimistic-concurrency storage for offline embedded feature catalogs using isolated `TogglyCatalogs/{sha256}` RavenDB documents.

## Toggly.FeatureManagement.Storage.EntityFramework 3.7.0 - 2026-09-11

### Added
- Transactional, optimistic-concurrency catalog storage for the offline embedded dashboard, with a dedicated `TogglyCatalogs` table and catalog-only schema scripts.

### Changed
- The .NET 10 Entity Framework dependencies now use the stable 10.0.0 release.

## Toggly.FeatureManagement.Embedded 0.1.0 - 2026-09-11

### Added
- Offline embedded catalog runtime with atomic definition publication, local refresh diagnostics, and no-op usage and metrics reporting.
- Revision-bound import preview and additive application, including initial
  create-only imports and compatible context property additions.

### Fixed
- Initial catalog reads now have a hard timeout, unchanged revisions do not trigger definition notifications, and deleted enabled features notify state subscribers that they are off.
- Keep ownership of non-cooperative timed-out reads until completion, and honor
  refresh cancellation. Reconcile uncertain write outcomes without retrying.
- Enforce read and mutation size limits, reject changed content with reused
  revisions, prevent reset of disappeared loaded catalogs,
  retain registered entity schemas, and reject case-only import renames.

## Toggly.FeatureManagement.Catalog 0.1.0 - 2026-09-11

### Added
- Portable embedded feature catalog contracts, strict canonical JSON serialization, validation, and conditional storage interfaces.
- Read-only store capability for provider-independent dashboard startup checks.

### Fixed
- Validate the SDK-compatible targeting exclusion keys
  `Audience.Exclusion.Users:n` and `Audience.Exclusion.Groups:n`.

## 3.6.6

2026-09-07

### Fixed
- Embed MSBuild `$(Version)` into assembly informational/file/version
  attributes so runtime User-Agent is never empty. 3.6.5 emitted
  `toggly-dotnet/` (and metrics `Toggly.FeatureManagement/`) because
  `GenerateAssemblyInfo` was false and `AssemblyInfo.cs` had no version.

### Changed
- Usage, metrics, and definitions User-Agents all use
  `toggly-dotnet/{semver}` via shared `TogglySdkIdentity` (platform
  `SdkUserAgentParser` shape).

## 3.6.5

2026-09-06

### Added
- Definition-refresh cache hits and misses (`definitionCacheHits` /
  `definitionCacheMisses`) on usage `SendStats`, counted once per refresh
  outcome (304, skipped poll, durable snapshot, keep-last-on-error = hit;
  new revision from HTTP/WebSocket = miss). Not counted per `IsEnabled`.

### Changed
- Usage gRPC `UA` metadata now sends `toggly-dotnet/{version}` (same shape as
  HTTP definitions requests and platform `SdkUserAgentParser`), instead of
  `Toggly.FeatureManagement/{version}`.
- `_loaded` is set only after a successful snapshot apply or first network
  definitions apply, so callers waiting on load no longer observe empty defs
  mid-refresh.

## 3.6.4

2026-09-06

### Changed
- Portable PDBs are included in each `.nupkg` (in addition to `.snupkg`) so
  Source Link, deterministic path mapping, and compiler metadata are visible
  to nuget.info / NuGet Package Explorer without the symbol server.

## 3.6.3

2026-09-05

### Changed
- Dapper and MongoDB storage packages now target the same framework matrix as
  the rest of the .NET SDK family (`netstandard2.1` through `net9.0`), plus
  `net10.0`. EntityFramework stays `net6.0+` because EF Core requires it.
- Deterministic builds, centralized SourceLink (`Microsoft.SourceLink.GitHub`
  8.0.0), and snupkg symbol packages now apply to all eleven NuGet packages
  (including Hangfire and EntityFramework) via `Directory.Build.props`.
- Release signs both `.nupkg` and `.snupkg` with the existing Key Vault
  certificate; GitHub Releases publish GPG-signed SHA-256 checksums.

## 3.6.2

2026-09-05

### Changed
- Package author, company, icon, and repository metadata now present as Toggly
  for all eleven NuGet packages. No API change.

## 3.6.1

2026-09-04

### Fixed
- `TogglyFeatureProvider` maps catalog short filter names (`Percentage`,
  `Targeting`, `TimeWindow`) to Microsoft.FeatureManagement aliases
  (`Microsoft.Percentage`, `Microsoft.Targeting`, `Microsoft.TimeWindow`)
  when building definitions for evaluation. Already-prefixed `Microsoft.*`
  names and other filters are unchanged.

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
