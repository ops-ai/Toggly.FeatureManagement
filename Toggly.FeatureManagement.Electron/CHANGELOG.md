# Changelog

All notable changes to this project will be documented in this file.

## [1.0.1] - 2026-09-12

### Fixed

- Updated signed-definition verification to `@ops-ai/toggly-signed-defs` 1.2.7 so Electron can verify signed responses in its ESM runtime.
- Added a compiled CommonJS preload entry for Electron's preload loader, including apps whose main process uses ESM.
- Corrected Electron SDK version attribution in request headers, the user agent, and evaluation query parameters.

## [1.0.0] - 2026-09-11

### Added

- Initial `@ops-ai/electron-feature-flags-toggly` release
- Main-process client using frontend App Key + `/evaluated-signed`
- Disk cache under Electron `userData`, signature verification via `@ops-ai/toggly-signed-defs`
- WebSocket live updates in the main process with renderer fan-out
- Preload `exposeToggly()` and Flutter-like renderer API (`init` in main; `isFeatureOn` / `Feature` in renderer)
- Optional React helpers: `Feature`, `useFeatureFlag`
