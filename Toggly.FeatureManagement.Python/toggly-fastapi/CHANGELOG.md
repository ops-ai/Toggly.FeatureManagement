# Changelog

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
