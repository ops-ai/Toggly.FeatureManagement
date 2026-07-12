# Changelog

## 0.1.2

2026-07-12

### Fixed
- `TogglyExpressConfig.onError` no longer conflicts with `TogglyServerConfig.onError` during DTS build (`Omit` + strip Express-only fields when creating the core client).
