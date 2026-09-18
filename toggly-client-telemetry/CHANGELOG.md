# Changelog

## 1.0.0 — 2026-09-18

### Added
- Portable frontend telemetry reporter with automatic-check, explicit usage/view,
  counter, gauge, awaitable flush and synchronous disposal APIs.
- Bounded batching, ordered retries, optional native gzip, request deadlines and
  independent metrics endpoint configuration.
- Validation of ingest-compatible variant names and metrics URLs, including
  empty query/fragment delimiters, before accepting events.
- Optional browser lifecycle adapter with automatic listener cleanup.
- Dependency-free ESM and CommonJS builds with portable TypeScript declarations.
