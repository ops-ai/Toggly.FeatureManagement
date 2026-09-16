# Changelog

## 0.2.0 — 2026-09-16

### Added
- Report definition-refresh cache hits and misses (`definitionCacheHits` /
  `definitionCacheMisses`) on `POST /api/usage/stats`. Counts one outcome per
  refresh attempt, including 304, same-revision 200, snapshot restore, and
  last-good network errors. Cache counters alone still flush.

### Fixed
- Send `User-Agent: toggly-elixir/{mix version}` on definition and usage
  requests instead of a stale `0.1.0` literal.

## 0.1.1 — 2026-09-14

### Fixed
- Accept optional filter parameters serialized as `null`, normalizing them to an
  empty map only after signature verification. Preserve original signed bytes
  for cold offline restoration, and keep malformed arrays/scalars rejected
  without replacing accepted definitions or persisted snapshots [OPS-1224].

## 0.1.0 — 2026-09-12

### Added
- Initial supervised Elixir feature evaluation and Phoenix/LiveView integration family.
- Optional validated `max_signature_age_seconds` rejects stale signed remote definitions and trusted snapshots while preserving active last-known-good state and ETags.

### Fixed
- Restore verified signed definitions before network access on a fresh client, retaining accepted public JWKS in a bounded, versioned application/environment/endpoint-scoped file. Configured keys, pins, expiry and age restrictions remain authoritative; corrupt snapshots fall back safely.
