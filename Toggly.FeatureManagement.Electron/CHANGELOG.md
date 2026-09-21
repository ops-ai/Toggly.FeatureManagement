# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-09-18

### Added

- Default-on compact telemetry with an application key, independent endpoint/interval/opt-out options and main-process ownership across windows.
- Explicit usage, view, counter, gauge and awaitable flush APIs in main, preload, renderer and React, with validated telemetry IPC and native gzip transport.
- Optional host-minted `instanceId` through the validated main/preload/renderer context path; telemetry uses the captured token or existing identity, never both.
- `attachTogglyLifecycle` for background flushing and bounded final quit; synchronous close remains available.

### Fixed

- Capture immutable definitions, gates and attribution before reentrant hooks; retire stale refresh/WebSocket work and keep terminal disposal authoritative.
- Keep validated disk bodies and revisions paired, snapshot writes atomically, and avoid recreating evicted bodies on a live 304.
- Build definitions paths independently of base queries and remove inherited tokens and token-suppressed targeting.

- Record effective cached/entity/local gate checks once and preserve gate short circuiting and negation.
- Avoid duplicate React checks during StrictMode replay and unchanged refreshes; hooks expose readiness and use their default until committed evaluation.
- Retire IPC/lifecycle listeners on reinitialization and prevent delayed initialization from restoring disposed resources.

## [1.0.2] - 2026-09-12

### Added

- Add packed Electron consumer-host validation for the retained Electron 28.3.3
  floor and Electron 44.3.0 current host. Both run actual main, compiled
  preload, context-isolated renderer IPC, and optional React feature helpers.

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
