# Changelog

## 1.1.1

2026-08-28

### Fixed

- Publish `@ops-ai/react-native-toggly-core` as `^1.7.1` instead of a `file:`
  path so the package installs from npm.

## 1.1.0

2026-07-03

### Changed

- MMKV read, write, delete, clear, and key-listing failures now propagate to the core SDK so consumers can observe storage problems through error reporting.
