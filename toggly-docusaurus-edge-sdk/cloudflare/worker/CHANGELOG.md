# Changelog

## 0.4.0

2026-09-09

### Added
- Report definition-refresh cache hits/misses on usage telemetry
  (`definitionCacheHits` / `definitionCacheMisses` on `POST api/usage/stats`).
- Count once per `getFlags` attempt: in-memory TTL hit, Cache API hit,
  network error keeping last-good hit, successful network apply miss.
- Soft-fail restore merges cache counters with in-flight records; cache-only
  batches still flush.

### Fixed
- Reuse page-gate flags for section HTML gating in the same request so
  definition cache hits are not double-counted.

### Notes
- N/A for this Worker (not instrumented): durable snapshot, WebSocket refresh,
  HTTP 304 / If-None-Match, concurrent in-flight refresh skip, ETag-equal 200.
- User-Agent remains `toggly-docusaurus-edge-worker/{version}`.
- `cache.put` stays fire-and-forget so write rejections cannot fail the request.

## 0.3.2

2026-09-06

### Fixed
- Flush the previous isolate `TelemetryRuntime` when `getOrCreateTelemetry`
  recreates the singleton after a mid-isolate config change, so buffered usage
  or metrics are not dropped.

## 0.3.1

2026-09-06

### Fixed
- Flush HTML telemetry via a pull-driven stream wrapper (client-driven
  backpressure) instead of `ReadableStream.tee()` + eager drain, which could
  buffer an entire response.
- Deduplicate `requestCount` per feature/variant within a single HTTP request
  so repeated section gates no longer inflate unique-request stats.
- Export business metrics APIs (`measure` / `incrementCounter` / `observe` via
  `TelemetryRuntime` / `createTelemetryFromEnv`) from the package root.

## 0.3.0

2026-09-06

### Added
- Batched feature usage and business metrics export over gateway-accepted HTTPS
  JSON (`api/usage/stats`, `api/metrics`) via `fetch` (Workers have no native
  gRPC). Soft-fails network errors so flag evaluation is never blocked.
- In-memory batchers with hard caps on unique identity hashes, feature count,
  metric keys, and observations; flush scheduled through `ctx.waitUntil`.
- Wire shape parity: `variantStats` / `variantValues`, UTF-8 FNV-1a signed int32
  identity hashes, ISO-8601 times on the HTTPS path.
- Env config: `TOGGLY_METRICS_BASE_URL` (default `https://app.toggly.io/`),
  `TOGGLY_USAGE_ENABLED`, `TOGGLY_METRICS_ENABLED`.
- User-Agent `toggly-docusaurus-edge-worker/{VERSION}` on telemetry POSTs.
- Records check/view when page and section gating evaluates.

## 0.2.1

2026-07-03

### Fixed

- Transient flag or manifest fetch failures no longer overwrite edge cache entries with empty fallback objects.
- Manifest fetch failures now preserve the in-memory last-known-good manifest when available.
