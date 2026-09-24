# Changelog

## 0.2.0 — 2026-09-23

### Added
- `Toggly.Phoenix.Plug.get_variant/2` and `get_variant_value/2` read
  `conn.assigns.toggly_context` / `toggly_client` so handlers need no manual
  context map [OPS-1407].

### Fixed
- `get_variant/2` raises a clear `ArgumentError` when the Plug has not run
  (missing `:toggly_client` assign) instead of a bare `KeyError`.

## 0.1.1 — 2026-09-16

### Changed
- Accept `toggly` 0.2.x (`~> 0.1`) so Hex installs pick up definition-cache
  usage fields [OPS-1248].

## 0.1.0 — 2026-09-12

### Added
- Initial supervised Elixir feature evaluation and Phoenix/LiveView integration family.
