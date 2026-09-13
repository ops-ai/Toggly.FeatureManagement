# Changelog

## 0.1.0 — 2026-09-12

### Added
- Initial supervised Elixir feature evaluation and Phoenix/LiveView integration family.

### Changed
- Replace the disabled-content `fallback` slot with a second `feature` block using
  the same flags, keys, requirement and default plus `negate={true}`. Both blocks
  use ordinary inner content; negation applies to the combined all/any result.
