# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-09-11

### Added

- Initial `@ops-ai/electron-feature-flags-toggly` release
- Main-process client using frontend App Key + `/evaluated-signed`
- Disk cache under Electron `userData`, signature verification via `@ops-ai/toggly-signed-defs`
- WebSocket live updates in the main process with renderer fan-out
- Preload `exposeToggly()` and Flutter-like renderer API (`init` in main; `isFeatureOn` / `Feature` in renderer)
- Optional React helpers: `Feature`, `useFeatureFlag`
