# Changelog

## 1.1.3

2026-09-12

### Changed

- Validate packed consumers against AsyncStorage 1.24, 2.2, and 3.1 while
  retaining the adapter's default singleton API and `@toggly:` key format.
- Use `removeItem` for each Toggly key when AsyncStorage 3 does not expose
  `multiRemove`, while retaining the batched clear path for earlier versions.
- Document current bare React Native and Expo host prerequisites. The package
  peer remains `>=1.17.0` because all retained AsyncStorage API generations
  expose the methods used by this adapter.

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

- AsyncStorage read, write, delete, clear, and key-listing failures now propagate to the core SDK so consumers can observe storage problems through error reporting.
