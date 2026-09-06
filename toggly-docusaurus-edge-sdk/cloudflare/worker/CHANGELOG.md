# Changelog

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
