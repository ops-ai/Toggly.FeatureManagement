# Changelog

## 3.10.0 — 2026-09-19

### Added
- Added `IFrontendIdentitySession.SetIdentityAsync` to atomically replace a frontend targeting context and minted token for definitions and telemetry.

### Fixed
- Preserve accepted telemetry attribution and gauge ordering across login, logout and token rotation while sharing one bounded queue.
- Isolate signed snapshots and conditional requests by minted token; context replacement clears the previous token.


## 3.9.0 — 2026-09-18

### Added
- WebAssembly sessions forward aggregate telemetry through the portable owner with credential-free browser fetch, hidden/pagehide flushing and listener cleanup. Companion APIs preserve compatibility with existing feature-session implementations.
- Independent metrics endpoint, bounded in-memory batching, gzip and explicit rate-limit retries; targeting context is excluded.

### Fixed
- Telemetry flush cancellation completes without throwing while preserving shared delivery ownership.
- Diagnostic callbacks emit each fixed code at most once per client lifetime.
- Hidden-page transitions use plain keepalive requests, matching pagehide and final disposal.


## 3.8.0 — 2026-09-14

### Changed
- Align package and assembly versions with the shared .NET SDK version.

## 3.7.0 — 2026-09-13

### Changed
- Align package and assembly versions with the shared .NET SDK version.
- Keep internal Toggly dependencies on that same version.

## 0.1.0 — 2026-09-12

### Changed
- Standardize complementary content on paired `Feature` components and remove the unpublished `Enabled` and `Disabled` fragments; use identical inputs with `Negate="true"` for the off branch.
- Persist verified browser snapshots in durable localStorage so a new browser runtime can restore definitions and accepted public keys without a definitions-service connection. Revalidate context, key restrictions, signature age and the signature on every restoration.

### Added
- Native child/loading Feature components and programmatic all/any/negate/entity gates.
- Scoped browser and trusted server sessions, authentication synchronization, renderer dispatch, reconnect and disposal.
- Explicit public boolean hydration allowlist and lazy browser WebCrypto/localStorage adapters.
- .NET 8 packages, complete Blazor render-mode samples and grouped test/analysis/manual release integration.

### Fixed
- Keep feature gates in loading content while the current asynchronous evaluation is pending, including live context changes; superseded results cannot end that loading state.
