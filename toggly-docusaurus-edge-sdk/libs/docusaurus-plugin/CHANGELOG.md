# Changelog

## 0.6.0

2026-06-22

### Added
- `staticGating` plugin option: fetches Toggly flags once at build time and bakes
  gating into static HTML. No runtime API calls, WebSocket, or edge worker required.
- `isStaticGatingMode()` and `readBuildFlagsSnapshot()` client helpers.
- Build-time replacement of disabled `x-feature` pages with the site 404 HTML.

### Changed
- When `staticGating: true`, the `nav-gate` client module is not loaded (sidebar
  swizzles use the baked flag map instead).
