# Changelog

## 0.1.0 — 2026-09-12

### Changed
- Persist verified browser snapshots in durable localStorage so a new browser runtime can restore definitions and accepted public keys without a definitions-service connection. Revalidate context, key restrictions, signature age and the signature on every restoration.

### Added
- Native enabled/disabled/loading Feature components and programmatic all/any/negate/entity gates.
- Scoped browser and trusted server sessions, authentication synchronization, renderer dispatch, reconnect and disposal.
- Explicit public boolean hydration allowlist and lazy browser WebCrypto/localStorage adapters.
- .NET 8 packages, complete Blazor render-mode samples and grouped test/analysis/manual release integration.

### Fixed
- Keep feature gates in loading content while the current asynchronous evaluation is pending, including live context changes; superseded results cannot end that loading state.
