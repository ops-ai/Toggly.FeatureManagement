# Changelog

## 0.4.0

### Added
- Client-held targeting identity: `:identity` start option, `Toggly.set_identity/2`,
  and `Toggly.identity/1`. When `get_variant/4` / `get_variant_value/4` receive
  an empty context identity, the client default is merged so
  `get_variant(client, key)` works after config or `set_identity` [OPS-1407].
- `Toggly.Phoenix.Plug.get_variant/2` and `get_variant_value/2` read
  `conn.assigns.toggly_context` (set by the Plug) so callers need not pass
  context maps by hand [OPS-1407].

## 0.3.0

### Added
- Catalog-local feature variants: `Toggly.get_variant/4` /
  `Toggly.get_variant_value/4` and `Toggly.Variant` /
  `Toggly.Variant.Assignment`. Assignment (user → group → percentile →
  `DefaultWhenEnabled` / `DefaultWhenDisabled`, percentile SHA-256 hash,
  `statusOverride` applied to the effective enabled state) matches
  `Microsoft.FeatureManagement` 4.7.0 (`IVariantFeatureManager`) bit-for-bit;
  verified against the shared `variant-allocator-corpus` gold corpus (18/18
  cases). No dual-rail network call — variants are read from the same
  definitions catalog map that already drives `enabled?/4` [OPS-1395].
- `:ignore_case` option on `get_variant/4` for case-insensitive user/group
  targeting, mirroring `TargetingEvaluationOptions.IgnoreCase` (default
  `false`) [OPS-1395].
- `Toggly.record_usage/4` and `Toggly.record_view/4` accept an optional
  variant name to attribute usage/view counters to that variant instead of
  the `enabled`/`disabled` label [OPS-1395].

## 0.2.1 — 2026-09-17

### Fixed
- Default `usage_base_url` for `POST /api/usage/stats` is `https://metrics.toggly.io`.

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
