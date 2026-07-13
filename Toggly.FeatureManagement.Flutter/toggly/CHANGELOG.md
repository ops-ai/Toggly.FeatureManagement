## 1.9.1

2026-07-13

### Fixed
- Guaranteed first HTTP definitions fetch when live updates are enabled: WebSocket
  connectivity and `sync` messages with `unchanged: true` no longer suppress
  polling or refresh until `_lastSynced` is set. Prevents cold starts (e.g. iOS
  inactive splash) from remaining forever on seeded `flagDefaults`.
- Clearing in-memory evaluation state on identity/context change also clears
  `_lastSynced` / `_lastChecked` so a follow-up fetch is required for the new
  context.

## 1.9.0

2026-07-11

### Added
- `TogglyConfig.maxCacheKeys` opt-in LRU eviction for identity-scoped flags,
  variants, and revision cache entries (sidecar index via
  `TogglyCacheProvider.readCacheLruIndex` / `writeCacheLruIndex`).
- `LruTogglyCacheProvider` wrapper applied automatically in `Toggly.init` when
  `maxCacheKeys` is a positive integer and a `cacheProvider` is supplied.
- Shared `cache_lru` helpers matching the JS `@ops-ai/toggly-hooks-types`
  index JSON shape.

### Changed
- `TogglyCacheProvider` adds `readCacheLruIndex` / `writeCacheLruIndex` with
  no-op defaults; official cache providers override them to persist the sidecar
  index.

## 1.8.0

2026-07-07

### Changed
- Definitions revision (ETag) persistence is scoped per evaluation identity
  (user, groups, claims — same key as flags/variants) so multiple users on
  one app each retain their own `If-None-Match` value across cold starts and
  user switches.
- `setIdentity` / `setContext` clear in-memory evaluation state only; persisted
  flags, variants, and revisions for other users are kept for switch-back.
- `TogglyRevisionCacheProvider` read/write/delete methods now take an
  `identity` parameter (breaking change for custom cache backends).
- Rejected definition rollbacks are logged in debug mode only; they no longer
  invoke `TogglyConfig.onError` while the SDK keeps cached flags.

### Note
- Upgrading from pre-1.8.0 revision storage (`appKey`/`environment` only):
  official cache providers migrate legacy revision keys on first read. Custom
  backends should do the same or expect one extra full fetch per identity.

## 1.7.1

2026-07-07

### Fixed
- Anti-rollback for signed definitions now rejects only strictly **older**
  timestamps (`<`), not equal ones. Equal timestamps are the same
  definitions re-served (e.g. cold start without a persisted ETag) and are
  accepted instead of wiping flags back to `flagDefaults`.
- On a genuine rollback attempt, the SDK keeps the newer cached flags (or
  variants), re-emits them to the stream, and returns `cached` — it no longer
  calls `clearFeatureFlagsCache()` and downgrade to defaults.

## 1.7.0

2026-07-07

### Added
- `FeatureGateBuilder` widget exposes the resolved gate boolean via a `builder`
  callback for conditional UI (styling, taps) without duplicating
  `StreamBuilder` + `evaluateFeatureGateSync` boilerplate.
- `Feature.builder` named constructor as sugar over the same evaluation path.

## 1.6.0

2026-07-05

### Added
- `setContext({ identity, groups, claims })` for evaluated-signed targeting (User Claims, group rules).
- Context-aware cache keys including groups and claims.

## 1.5.1

2026-07-05

### Added
- SDK identity on definitions traffic: User-Agent on server HTTP, custom headers on browser/web HTTP, sdk + sdkVersion query params on WebSocket.


## 1.5.0

2026-07-05

### Added
- ETag-based WebSocket sync: merged definitions revision for all definition fetches (`If-None-Match`), `?rev=` on WebSocket connect, and handling for `sync`, `flags-updated`, and `signing-key-updated` messages.
- Optional `TogglyRevisionCacheProvider` for persisting definitions revision across restarts when a cache backend supports it.

### Changed
- WebSocket reconnect uses exponential backoff (5s base, 60s cap) and coalesces refresh callbacks with a 300ms debounce.
- Timer polling is suppressed while the WebSocket is reconnecting.

## 1.4.0

2026-07-03

### Added
- `TogglyConfig.onError` reports cache, signature, JWKS, and refresh failures to SDK consumers.
- `featureFlagsStream` and a synchronous feature flag snapshot make Feature widgets reactive to refreshed flag data.

### Fixed
- Preserved last-known-good cached flags during transient signature/JWKS failures so feature content does not disappear silently.
- Reported fresh signed-definition verification failures while clearing invalid fresh data.

## 1.3.0

2026-06-28

### Added
- Device-local post-filter gates (`LocalGate`, `setLocalGates`, `notifyLocalGatesChanged`, `onLocalGatesChanged`) that AND worker booleans at read time
- `TogglyConfig.localGates` for init-time registration
- `Feature` widget re-evaluates when local gates change
- Pure helpers in `local_gates.dart` (`applyLocalGate`, `buildFlagGateIndex`, etc.)

## 1.2.2

2026-06-16

### Fixed
- Targeting: pass `identity` to `/evaluated-signed` via Dio `queryParameters`
  (`u=`) so values are URL-encoded. Embedding raw identity in the request URL
  could corrupt identities containing `+`, `@`, `/`, or other reserved
  characters, so targeted users were not matched on the edge worker.

## 1.2.1

2026-06-15

### Fixed
- Packaging: `.pubignore` now excludes `build/` and other transient artifacts so
  the published archive no longer bundles the local build cache (which had
  pushed it past pub.dev's 100 MB limit).

### Changed
- Added the `repository` field pointing to
  https://github.com/ops-ai/Toggly.FeatureManagement.

## 1.2.0

2026-05-30

### Breaking
- The SDK no longer bundles `flutter_secure_storage` and is now memory-only by default. The internal `SecureStorageService`/`SecureStorageKeys` (previously exported) have been removed.
- Anonymous device identity is no longer persisted. When no `identity` is provided to `init`/`setIdentity`, an ephemeral in-memory id is used; pass a stable `identity` for consistent targeting and offline restart.

### Added
- New typed `TogglyCacheProvider` contract and `TogglyConfig.cacheProvider`. Supply an implementation to persist flags, variants, and JWKS across app restarts. The controlling app owns where data is stored.
- Companion persistence packages: `feature_flags_toggly_secure_storage`, `feature_flags_toggly_disk`, `feature_flags_toggly_sqlite`, `feature_flags_toggly_isar`.
- `TogglyFeatureFlagsCache`/`TogglyVariantsCache` cache models are now exported for provider implementations.

### Changed
- ETags are kept in memory only and are no longer persisted (first fetch after a cold start is a full, non-304 response).
- Removed secure-storage background/foreground guards that are no longer needed; memory access is always safe.

### Migration
- Apps needing offline support across restarts should add one of the `feature_flags_toggly_*` companion packages (or implement `TogglyCacheProvider`) and pass it via `TogglyConfig(cacheProvider: ...)`, along with a stable `identity`.


## 1.1.16

2026-04-08

### Maintenance
- Satisfied pub.dev publish checks: bounded runtime dependency versions, `.pubignore` for the local benchmark app (not shipped on pub.dev), top-level `benchmarks/` renamed to `benchmark/` for layout consistency, and minor analyzer cleanups in `toggly.dart`.


## 1.1.15

2025-05-15

### Reliability
- Fixed features being cached in some cases when switching identities


## 1.1.14

2025-03-28

### Reliability
- Simplified state check

## 1.1.13

2025-03-20

### Reliability
- Added more info to debug method

## 1.1.12

2025-03-19

### Reliability
- Added debug method for visibility into current state


## 1.1.11

2025-03-13

### Reliability
- Added more background state checks before any secure storage operations

### Breaking Changes
- None

## 1.1.10

2025-03-13

### Reliability
- Added background state checks before any secure storage operations

### Breaking Changes
- None

## 1.1.9

2025-03-10

### Reliability
- Added app lifecycle state monitoring to only refresh features when app is in the foreground

### Breaking Changes
- None


## 1.1.8

2025-02-19

### Reliability
- Improved offline support by properly handling cached feature flags
- Added fallback to default values when cache is invalid or missing
- Added better error handling for signature verification
- Added debug logging for troubleshooting

### Breaking Changes
- None

## 1.1.7

2025-02-15

* Fixed bug in check when identity changes.

## 1.1.6

2025-02-15

* Added logic to clear cached feature flags if identity changes.

## 1.1.5

2025-02-15

* Fixed clearing etag as well if deserialization fails or verification fails.

## 1.1.4

2025-02-14

* Clear cached feature flags if cache deserialization or verification fails.

## 1.1.3

2025-02-12

* Return cached feature flags if the API call fails

## 1.1.2

2025-02-07

* Added timestamp verification for signed definitions.
* Added certificate whitelist for signed definitions.
* Added benchmarks for API evaluation.
* Performance improvements.

## 1.1.1

2025-02-05

* Updated documentation to include key rotation information.

## 1.1.0

2025-02-05

* Added support for offline validation of signed definitions.

## 1.0.9

2025-01-25

* Added support for signed definitions.

## 1.0.8

2025-01-23

* Added support for multiple children in Feature widget.

## 1.0.5

2023-06-01

* Better dependencies support.

## 1.0.4

2023-06-01

* Better dependencies support.

## 1.0.3

2022-11-22

* Added static "dispose" method to clear timers & cancel streams.

## 1.0.2

2022-11-22

* More doc comments

## 1.0.1

2022-11-22

* Doc comments
* Fixed Lint issues
* Cleaned unused methods *.featureGateFuture and replaced with *.evaluateFeatureGate

## 1.0.0

2022-11-13

* Toggly & Feature classes
* Allow usage without Toggly service (by providing flagDefaults)
* Allow usage with Toggly service (by providing your App Key & Environment name)
* Feature Gate unit tests
* Documentation
* License



