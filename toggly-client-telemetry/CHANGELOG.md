# Changelog

## 1.1.0 — 2026-09-19

### Added
- Synchronous `setContext` for changing app/environment and identity attribution
  without losing immediate events or relabeling accepted counters and gauges.
- `dispose({ flush: false })` to cancel and discard a reporter before replacing
  its transport settings or disabling telemetry.

### Changed
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
