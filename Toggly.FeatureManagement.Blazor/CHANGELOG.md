# Changelog

## 0.1.0 — 2026-09-12

### Added
- Native enabled/disabled/loading Feature components and programmatic all/any/negate/entity gates.
- Scoped browser and trusted server sessions, authentication synchronization, renderer dispatch, reconnect and disposal.
- Explicit public boolean hydration allowlist and lazy browser WebCrypto/sessionStorage adapters.
- .NET 8 packages, complete Blazor render-mode samples and grouped test/analysis/manual release integration.

### Fixed
- Keep feature gates in loading content while the current asynchronous evaluation is pending, including live context changes; superseded results cannot end that loading state.
