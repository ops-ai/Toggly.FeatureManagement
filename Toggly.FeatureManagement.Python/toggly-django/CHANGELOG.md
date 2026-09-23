# Changelog

## 0.5.0 - 2026-09-23

### Changed
- Requires `toggly>=1.0.0`. Feature variants are now assigned locally from
  cached feature definitions instead of a separate remote-variants request;
  use `get_client().get_variant(feature_key, user_id=...)`.

### Breaking Changes
- Removed the `ENABLE_VARIANTS`, `VARIANT_GROUPS`, and `VARIANT_CLAIMS`
  `TOGGLY` settings, and the matching `configure_toggly(...)` keyword
  arguments. Passing them now raises a `TypeError`. Remove them from your
  Django settings / `configure_toggly` calls and use per-request
  `get_variant(feature_key, user_id=..., groups=[...])` instead.

## 0.4.1 - 2026-09-12

### Changed
- Add packed-host validation and package metadata for Django 5.2, 6.0, and
  6.1. Django 4.2, 5.0, and 5.1 remain covered by retained regression rows.

## 0.4.0 - 2026-09-12

### Added
- Optional `negate=True` or Django filter expression on `iffeature` blocks.
  Use matching positive and negated blocks for enabled and disabled content.

### Compatibility
- Existing feature-key interpretation and legacy `else` blocks remain supported.
  Negation changes only the final rendering decision; request context, decorators
  and programmatic helpers are unchanged.

## 0.3.0 - 2026-09-08

### Added
- Initial application-wide variant groups and string claims, alongside identity.

### Fixed
- Forward startup identity and variant context before client initialization; require core 0.7.0.


## 0.2.0

2026-08-21

### Added
- Forward `request.toggly_entity` into evaluation context for ContextProperty filters.
