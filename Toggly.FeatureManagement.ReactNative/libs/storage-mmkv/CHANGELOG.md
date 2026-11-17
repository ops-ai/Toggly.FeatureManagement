## Unreleased

### Changed
- `engines.node` floor raised from `>=18` to `>=22` (Node 18 and 20 are EOL).
- CI unit matrix exercises Node 22, 24, and 26.
- Packed host fixture React Native pin refreshed from 0.87.1 to 0.88.1.

# Changelog

## 1.1.3

2026-09-14

### Fixed

- Limit the legacy adapter's `react-native-mmkv` peer to the MMKV 2 and 3
  API generations it uses. MMKV 4 uses the separate
  `@ops-ai/react-native-toggly-storage-mmkv4` package because its Nitro API
  replaces the constructor and delete methods used here.


## 1.1.2

- Normalize public npm metadata for provenance and docs links (no API change).

## 1.1.1

2026-08-28

### Fixed

- Publish `@ops-ai/react-native-toggly-core` as `^1.7.1` instead of a `file:`
  path so the package installs from npm.

## 1.1.0

2026-07-03

### Changed

- MMKV read, write, delete, clear, and key-listing failures now propagate to the core SDK so consumers can observe storage problems through error reporting.
