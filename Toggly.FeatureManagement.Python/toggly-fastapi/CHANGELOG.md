# Changelog

## 0.4.0 - 2026-09-23

### Changed
- Requires `toggly>=1.0.0`. Feature variants are now assigned locally from
  cached feature definitions instead of a separate remote-variants request;
  use `get_toggly_client().get_variant(feature_key, user_id=...)`.

### Breaking Changes
- Removed the `enable_variants`, `variant_groups`, and `variant_claims`
  keyword arguments from `configure_toggly(...)`. Remove them from your
  startup call and use per-request `get_variant(feature_key, user_id=...,
  groups=[...])` instead.

## 0.3.1 - 2026-09-12

### Changed
- Declare Python 3.14 compatibility and validate the packed middleware with
  FastAPI 0.141.1. Existing Python 3.9+ support remains unchanged.

## 0.3.0 - 2026-09-08

### Added
- Initial application-wide variant groups and string claims, alongside identity.

### Fixed
- Forward startup identity and variant context before client initialization; require core 0.7.0.


## 0.2.0

2026-08-21

### Added
- Forward `request.state.toggly_entity` into evaluation context for ContextProperty filters.
