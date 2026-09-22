# Changelog

## 0.4.0 — 2026-09-22

### Added

- Opt-in `enableVariants` on `createClient`/`createToggly`. When set, the client fetches `/evaluated-variants-signed` instead of `/evaluated-signed` and exposes `getVariant`/`getVariantValue` on the low-level client and the `Toggly` facade, plus a reactive `useVariant` hook. Matches the JS/Vue SDKs: null when variants are disabled, the feature is off, or no variant is assigned; local gates can suppress an assigned variant but never invent one.
- Signed/persisted variant envelopes reuse the existing verify-and-cache pipeline: `/evaluated-variants-signed` and `/evaluated-signed` responses are validated and cached under their own distinct scope, so switching `enableVariants` never resurrects the other mode's cached body. Identity/context changes refetch from the active endpoint the same way boolean mode already does.

## 0.3.0 — 2026-09-18

### Added

- Browser telemetry enabled by default with an application key, with independent endpoint, interval and opt-out options.
- Explicit `recordUsage`, `recordView`, `incrementCounter`, `setGauge` and awaitable `flushTelemetry` on clients and the Solid facade. Metrics are application-level; optional owner attribution uses minted `i` or client-asserted `u`, with no entity data.
- Effective feature checks shared across direct evaluations, hooks and components; hidden-page and owner cleanup flush pending events.

### Fixed

- Preserve accepted snapshots and configured defaults in server-rendered feature accessors and Provider consumers while retaining construction-time owner disposal.
- Keep cleared instance tokens out of configured URLs and normalize tokens in consecutive route snapshots.
- Retire clients when synchronous diagnostics or transports dispose their Solid owner during construction.

- Keep memoized feature reads and loading/error updates from duplicating checks. Initial snapshot hydration no longer reapplies the same provider input.
- Release outstanding definition-request timeout resources during synchronous owner disposal.

### Changed

- Use public reporter 1.1.0 and forward host-minted instance tokens through existing context APIs; token targeting suppresses user/groups/claims.
- Preserve admitted attribution and snapshot selected nested entity gates before reentrant callbacks.
- Keep signed storage token-scoped and validators paired with accepted memory bodies; reject orphan 304 revisions and unrelated token snapshots.
- Retire old context sockets and fence stale responses and subscriber publication.

## 0.2.0 — 2026-09-12

### Changed

- Remove the provisional `Feature.fallback` prop. Render disabled content in a separate `Feature` block with the same feature, requirement and entity plus `negate`; loading remains a separate state.

### Added

- Node-only SolidStart server entrypoint with request-scoped evaluation and guards using the shared Node client.
- Explicit frontend signed snapshot allowlists, safe serialization, SSR initialization, and reactive navigation hydration.
- Packed SolidStart 2 host coverage for server/client boundaries and lifecycle.

### Fixed

- Preserve signed SSR/hydration and accepted memory over persisted records; restore only for defaults after a fresh start or context reset.
- Restore verified definitions after a fully offline restart by persisting the exact signed envelope and its verified public key in opt-in, targeting-scoped storage.
- Revalidate key constraints, signature age and full entity schema on restore, retire historical storage on key rotation, and reject older signed state within each running context.
- Separate refresh cache, transport and acceptance steps while preserving signed state and revision behavior.
- Capture exact response bytes for string, URL and Request inputs and harden packed-host npm invocation.
- Isolate synchronous and asynchronous error observers from server snapshot defaults.
- Validate complete signed entity maps before projection, state updates or revision adoption.
- Require packed SolidStart host success in the grouped analysis summary.
- Bypass native HTTP caches while retaining explicit polling revision headers, so live invalidations cannot reuse stale browser validators.

## 0.1.0 — 2026-09-12

### Added

- Native Solid provider, signals, accessors, resource/Suspense and lazy declarative gates.
- Isolated targeting, verified signed definitions/cache, live updates, entity and device-local gates, and lifecycle disposal.

### Fixed

- Honor plain-text live invalidations and fetch unconditionally when update notifications omit a revision.
