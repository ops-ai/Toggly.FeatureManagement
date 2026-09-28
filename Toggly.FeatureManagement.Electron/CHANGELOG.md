# Changelog

All notable changes to this project will be documented in this file.

## [1.2.2] - 2026-09-28

### Fixed

- Definition refreshes use `cache: 'no-store'` so HTTP caches cannot replay a
  stale evaluated GET under the same storage revision [OPS-1568].

## [1.2.1] - 2026-09-27

### Fixed

- Preserve normalized definition revision validators when an upstream response
  contains unusually long leading or trailing quote wrappers.

## [1.2.0] - 2026-09-26

### Added

- Opt-in `enableVariants` on `TogglyElectronConfig`. When set, the main-process client fetches `/evaluated-variants-signed` instead of `/evaluated-signed` and exposes `getVariant` / `getVariantValue` on the client, singleton helpers, IPC, preload bridge, and renderer wrappers.
- Typed soft-null `getVariantValue<T>(…, isT?)` and exported `decodeVariantValue` helper matching the JS/Vue SDK contract: null when variants are disabled, the feature is off/local-gated, no variant is assigned, or an optional type guard fails.
- Variant assignments persist in the offline disk cache alongside flags (distinct cache scope from boolean mode) and are restored after a conditional (304) refresh, network failure, or cold start. Feature checks record the assigned variant name in telemetry instead of always recording `enabled`.

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
