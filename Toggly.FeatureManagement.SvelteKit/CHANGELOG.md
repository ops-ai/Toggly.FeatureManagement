# Changelog

## 0.2.0 — 2026-09-18

### Added

- Accept an optional host-minted instance token through the explicit public server snapshot projection and browser context; otherwise use identity attribution. Context updates preserve queued attribution and clear omitted tokens.
- Capture direct and composite gate definitions, local callbacks and attribution before reentrant evaluation. Minted definitions requests suppress client targeting, and signed caches remain isolated by the complete context URL.
- Aggregate browser telemetry for effective feature checks, explicit usage/views, counters and gauges, with opt-out and configurable collector/flush interval.
- Keep one layout-owned telemetry queue across navigation and refresh reconnects, with bounded lifecycle flushing and terminal cleanup. SSR and keyless stores remain silent.

## 0.1.0 — 2026-09-12

### Changed

- Remove the provisional Feature fallback slot. Render disabled content in a separate Feature with the same gate options and `negate: true`; SSR and browser rendering still use the current snapshot immediately.

### Added

- Keep failed key-retirement persistence disabled across navigation and reconnects in the same layout.
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
