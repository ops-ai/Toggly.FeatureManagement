# Changelog

## 1.1.1 — 2026-09-23

### Fixed
- Construct the complete telemetry endpoint URL before parsing it, so React Native Hermes sends to `/api/frontend/telemetry` even when its native `URL.pathname` setter is inert. Browser and Node URL validation and credential omission remain unchanged.

## 1.1.0 — 2026-09-19

### Added
- Synchronous `setContext` for changing app/environment and identity attribution
  without losing immediate events or relabeling accepted counters and gauges.
- `dispose({ flush: false })` to cancel and discard a reporter before replacing
  its transport settings or disabling telemetry.

### Changed
- Automatic evaluation checks retain their original attribution when a host
  callback changes identity or replaces the client during evaluation.
- All context partitions share one admission budget and preserve gauge ordering.
- Retries reuse the original transport bytes; disposal aborts pending attempts
  where supported and prevents delayed compression from sending afterward.

## 1.0.0 — 2026-09-18

### Added
- Portable frontend telemetry reporter with automatic-check, explicit usage/view,
  counter, gauge, awaitable flush and synchronous disposal APIs.
- Optional `instanceId` (`i`) and `identity` (`u`) on compact envelopes. When both
  are set, only the minted instance id is sent. Groups and claims stay off the
  metrics body.
- Bounded batching, ordered retries, optional native gzip, request deadlines and
  independent metrics endpoint configuration.
- Validation of ingest-compatible variant names and metrics URLs, including
  empty query/fragment delimiters, before accepting events.
- Optional browser lifecycle adapter with automatic listener cleanup.
- Dependency-free ESM and CommonJS builds with portable TypeScript declarations,
  including browser subpath resolution in classic Node TypeScript configurations.
