# Changelog

## 0.2.1

2026-07-03

### Fixed

- Transient flag or manifest fetch failures no longer overwrite edge cache entries with empty fallback objects.
- Manifest fetch failures now preserve the in-memory last-known-good manifest when available.
