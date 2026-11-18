# Changelog

## 0.1.2 — 2026-11-18

### Changed
- Republish with Elixir requirement `~> 1.18` (OTP 27+) so Hex consumers pick up
  the floor widened on develop in #913. Hex cannot overwrite 0.1.1, which still
  declares `~> 1.20`. No public API or flag-evaluation behavior changes.

## 0.1.1 — 2026-09-16

### Changed
- Accept `toggly` 0.2.x (`~> 0.1`) so Hex installs pick up definition-cache
  usage fields [OPS-1248].

## 0.1.0 — 2026-09-12

### Added
- Initial supervised Elixir feature evaluation and Phoenix/LiveView integration family.

### Changed
- Replace the disabled-content `fallback` slot with a second `feature` block using
  the same flags, keys, requirement and default plus `negate={true}`. Both blocks
  use ordinary inner content; negation applies to the combined all/any result.
