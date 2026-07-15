# Changelog

## 1.0.2

2026-07-14

### Changed
- **Breaking behavior:** `defineFeatureMiddleware` and `defineFeatureHandler` now fail closed with HTTP **503** when the server Toggly client is not initialized. Previously they allowed the request / ran the handler (fail open). Ensure `initServerToggly()` runs (e.g. Nitro plugin) before using gated routes, or gated endpoints will return 503.

### Fixed
- Misconfigured apps no longer silently bypass feature gates when the server client is missing.
