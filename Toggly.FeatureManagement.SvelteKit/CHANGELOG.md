# Changelog

## 0.1.0 — 2026-09-12

### Added

- SvelteKit Node hook with one copied evaluation context per request and server load/action guards using Node core.
- Explicitly allowlisted signed frontend hydration that preserves entity gates and never serializes backend configuration.
- Layout-owned Svelte store, declarative Feature component, all/any/negate/defaults, local gates, navigation replacement and disposal.
- Layout-owned refresh and WebSocket lifecycle around shared signed transport, with unconditional invalidations, verified conditional polling, key rotation, cancellation and in-memory recovery.
- Isolate throwing or rejecting error observers so server defaults, browser recovery and cleanup remain reliable.
- Validate the complete signed evaluated map before serialization or revision adoption; malformed entity rules retain server defaults or the browser's last verified state.

### Fixed

- Restore verified signed frontend definitions after offline restart with optional scoped envelope/public-key storage and current trust/freshness/schema checks.
- Preserve authoritative SSR/live state above older persistent records, retain observed key trust across layout navigation, and isolate retired in-flight key responses.
- Include only the verified selected public key and timestamp in server hydration metadata; current browser key pins still constrain signed seeds.
