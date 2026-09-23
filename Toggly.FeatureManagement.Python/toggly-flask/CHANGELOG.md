# Changelog

## 0.4.0 - 2026-09-23

### Changed
- Requires `toggly>=1.0.0`. Feature variants are now assigned locally from
  cached feature definitions instead of a separate remote-variants request;
  use `get_client().get_variant(feature_key, user_id=...)`.

### Breaking Changes
- Removed the `TOGGLY_ENABLE_VARIANTS`, `TOGGLY_VARIANT_GROUPS`, and
  `TOGGLY_VARIANT_CLAIMS` Flask config keys. Remove them from your app
  config and use per-request `get_variant(feature_key, user_id=...,
  groups=[...])` instead.

## 0.3.1 - 2026-09-12

### Changed
- Declare Python 3.14 compatibility and validate the packed extension with
  Flask 3.1. Existing Python 3.8+ support remains unchanged.

## 0.3.0 - 2026-09-08

### Added
- Initial application-wide variant groups and string claims, alongside identity.

### Fixed
- Forward startup identity and variant context before client initialization; require core 0.7.0.


## 0.2.0

2026-08-21

### Added
- Forward `g.toggly_entity` into evaluation context for ContextProperty filters.
