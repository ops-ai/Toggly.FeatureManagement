# Changelog

## 1.0.0

2026-09-14

### Added

- Initial MMKV 4 storage adapter using the Nitro `createMMKV` and `remove`
  APIs. It preserves Toggly's `toggly:` key prefix, storage ID, path, and
  encryption configuration while keeping MMKV 2 and 3 in the legacy package.
- Require `react-native-nitro-modules` 0.37.1 for the current React Native JSI
  hook; the packed host fixture locks that compatible runtime line.
