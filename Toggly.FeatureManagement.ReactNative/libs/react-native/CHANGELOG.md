# Changelog

## 1.2.1

2026-08-28

### Fixed

- Publish `@ops-ai/react-native-toggly-core` as `^1.7.1` instead of a `file:`
  path so the package installs from npm.

## 1.2.0

2026-07-03

### Changed

- Bumped `@ops-ai/react-native-toggly-core` to 1.2.0 for observable errors and signed-definition reliability fixes.

### Fixed

- Provider, `Feature`, and `useFeatureFlag` now re-render from the `effectiveFlagsChanged` event so cached, fallback, local gate, and refreshed flags update UI consistently.

## 1.1.0

2026-06-28

### Changed

- Bumped `@ops-ai/react-native-toggly-core` to 1.1.0 for device-local post-filter gates support.
